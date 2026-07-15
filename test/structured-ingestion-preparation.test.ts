import { describe, expect, it, vi } from "vitest";
import type { EmbeddingClient } from "../src/ai/embedding-client.js";
import type { LlmClient } from "../src/ai/llm-client.js";
import type { ChunkDraft } from "../src/ingestion/chunking/markdown.js";
import { IngestionService } from "../src/services/ingestion-service.js";
import type { ExtractedEvent } from "../src/types.js";
import {
  type FixtureLineageV3Envelope,
  validLineageV3Envelope
} from "./fixtures/lineage-v3-envelope.js";

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

  it("keeps v3 schema, evidence, and semantics through structured ingestion preparation without calling the LLM", async () => {
    const embeddings: EmbeddingClient = {
      generate: vi.fn(async () => [1, 0]),
      batchGenerate: vi.fn(async (texts: string[]) => texts.map(() => [1, 0]))
    };
    const llm: LlmClient = {
      extractNamedEntities: vi.fn(async () => []),
      rerankEvents: vi.fn(async () => []),
      extractEventsFromChunk: vi.fn(async () => {
        throw new Error("the LLM must not be called for a structured v3 event");
      })
    };
    const service = new IngestionService(embeddings, llm);
    const envelope = validLineageV3Envelope();
    const prepareEvents = (service as unknown as {
      prepareEvents(input: {
        input: { title: string };
        chunks: ChunkDraft[];
        concurrency: number;
      }): Promise<Array<{
        event: ExtractedEvent;
        entities: Array<{
          name: string;
          semantics?: { role: string };
          relationEmbedding: number[] | null;
        }>;
      }>>;
    }).prepareEvents.bind(service);

    const [prepared] = await prepareEvents({
      input: { title: "lineage" },
      chunks: [v3Chunk(envelope)],
      concurrency: 1
    });

    expect(prepared.event).toMatchObject({
      schema: envelope.schema,
      evidence: envelope.evidence,
      entities: envelope.entities
    });
    expect(prepared.entities.find((entity) => entity.name === "stage.orders_work")?.semantics)
      .toEqual({ role: "temporary" });
    expect(prepared.entities.every((entity) => entity.relationEmbedding === null)).toBe(true);
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

function v3Chunk(envelope: FixtureLineageV3Envelope): ChunkDraft {
  return {
    id: "chunk-v3",
    rank: 0,
    heading: envelope.title,
    content: envelope.content,
    rawContent: `## ${envelope.title}\n\n\`\`\`sag-event\n${JSON.stringify(envelope)}\n\`\`\``,
    sectionIds: []
  };
}
