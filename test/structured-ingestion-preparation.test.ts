import { describe, expect, it, vi } from "vitest";
import type { EmbeddingClient } from "../src/ai/embedding-client.js";
import type { LlmClient } from "../src/ai/llm-client.js";
import type { ChunkDraft } from "../src/ingestion/chunking/markdown.js";
import { IngestionService } from "../src/services/ingestion-service.js";

describe("structured lineage ingestion preparation", () => {
  it("keeps searchable entity embeddings but skips unused event-entity relation embeddings", async () => {
    const embeddings: EmbeddingClient = {
      generate: vi.fn(async () => [1, 0]),
      batchGenerate: vi.fn(async (texts: string[]) => texts.map(() => [1, 0]))
    };
    const llm: LlmClient = {
      extractNamedEntities: vi.fn(async () => []),
      rerankEvents: vi.fn(async () => []),
      extractEventsFromChunk: vi.fn(async () => [])
    };
    const service = new IngestionService(embeddings, llm);
    const chunks = [chunk("event-1", 0), chunk("event-2", 1)];
    const prepareEvents = (service as unknown as {
      prepareEvents(input: {
        input: { title: string };
        chunks: ChunkDraft[];
        concurrency: number;
      }): Promise<Array<{ entities: Array<{ relationEmbedding: number[] | null }> }>>;
    }).prepareEvents.bind(service);

    const prepared = await prepareEvents({
      input: { title: "lineage" },
      chunks,
      concurrency: 2
    });

    expect(embeddings.generate).toHaveBeenCalledTimes(3);
    expect(prepared.flatMap((event) => event.entities).every((entity) => entity.relationEmbedding === null)).toBe(true);
    expect(llm.extractEventsFromChunk).not.toHaveBeenCalled();
  });
});

function chunk(title: string, rank: number): ChunkDraft {
  const envelope = {
    schema: "snw.sql_lineage_event.v2",
    title,
    summary: "task_a reads db.a and writes db.b",
    content: "db.a flows to db.b",
    category: "TABLE_DATA_FLOW",
    keywords: ["task_a", "db.a", "db.b"],
    entities: [
      { type: "task", name: "task_a", description: "task" },
      { type: "table", name: "db.a", description: "source table" },
      { type: "table", name: "db.b", description: "target table" }
    ],
    relations: [{
      source: { type: "table", name: "db.a" },
      type: "DATA_FLOW",
      target: { type: "table", name: "db.b" },
      contextTask: "task_a"
    }]
  };
  const rawContent = `## ${title}\n\n\`\`\`sag-event\n${JSON.stringify(envelope)}\n\`\`\``;
  return {
    id: `chunk-${rank}`,
    rank,
    heading: title,
    content: envelope.content,
    rawContent,
    sectionIds: []
  };
}
