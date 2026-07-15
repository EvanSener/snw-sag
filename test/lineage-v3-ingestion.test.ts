import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddingClient } from "../src/ai/embedding-client.js";
import type { LlmClient } from "../src/ai/llm-client.js";
import { validLineageV3Envelope } from "./fixtures/lineage-v3-envelope.js";

const db = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn()
  };
  return {
    client,
    pool: {
      query: vi.fn(),
      connect: vi.fn()
    }
  };
});

vi.mock("../src/db/pool.js", () => ({ pool: db.pool }));

import { LineageSemanticsConflictError, upsertEntity } from "../src/db/repositories.js";
import { IngestionService } from "../src/services/ingestion-service.js";

const SOURCE_ID = "00000000-0000-0000-0000-000000000001";

describe("v3 entity semantics persistence", () => {
  beforeEach(() => {
    db.pool.query.mockReset();
    db.pool.connect.mockReset();
    db.client.query.mockReset();
    db.client.release.mockReset();
  });

  it("merges lineageSemantics without replacing existing entity metadata", async () => {
    db.pool.query
      .mockResolvedValueOnce({ rows: [{ id: "type-1" }] })
      .mockResolvedValueOnce({ rows: [entityRow("entity-1", "stage.tmp_a", {
        owner: "data-team",
        lineageSemantics: { role: "temporary", sourceSchema: "snw.sql_lineage_event.v3" }
      })] });

    await upsertEntity({
      sourceId: SOURCE_ID,
      type: "table",
      name: "stage.tmp_a",
      description: "temporary table",
      embedding: [1, 0],
      metadata: {
        lineageSemantics: { role: "temporary", sourceSchema: "snw.sql_lineage_event.v3" }
      }
    });

    const sql = normalizeSql(db.pool.query.mock.calls[1][0]);
    expect(sql).toContain("metadata = entities.metadata || excluded.metadata");
    expect(sql).toContain("entities.metadata->'lineageSemantics'");
    expect(sql).toContain("returning *");
    expect(JSON.parse(String(db.pool.query.mock.calls[1][1][8]))).toEqual({
      lineageSemantics: { role: "temporary", sourceSchema: "snw.sql_lineage_event.v3" }
    });
  });

  it("throws a safe conflict error when an existing entity has a different v3 role", async () => {
    db.pool.query
      .mockResolvedValueOnce({ rows: [{ id: "type-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(upsertEntity({
      sourceId: SOURCE_ID,
      type: "table",
      name: "stage.tmp_a",
      embedding: [1, 0],
      metadata: {
        lineageSemantics: { role: "temporary", sourceSchema: "snw.sql_lineage_event.v3" }
      }
    })).rejects.toEqual(expect.objectContaining({
      name: "LineageSemanticsConflictError",
      message: "Conflicting lineage semantics for table:stage.tmp_a"
    }));
    expect(LineageSemanticsConflictError).toBeDefined();
  });

  it("uses empty metadata for legacy events so v2 cannot clear stored v3 semantics", async () => {
    db.pool.query
      .mockResolvedValueOnce({ rows: [{ id: "type-1" }] })
      .mockResolvedValueOnce({ rows: [entityRow("entity-1", "warehouse.orders", {
        lineageSemantics: { role: "business", sourceSchema: "snw.sql_lineage_event.v3" }
      })] });

    await upsertEntity({
      sourceId: SOURCE_ID,
      type: "table",
      name: "warehouse.orders",
      embedding: [1, 0]
    });

    expect(JSON.parse(String(db.pool.query.mock.calls[1][1][8]))).toEqual({});
  });
});

describe("v3 ingestion transaction", () => {
  beforeEach(() => {
    db.pool.query.mockReset();
    db.pool.connect.mockReset();
    db.client.query.mockReset();
    db.client.release.mockReset();
    db.pool.connect.mockResolvedValue(db.client);
  });

  it("writes the source, evidence, semantics, and graph in one transaction", async () => {
    installTransactionQueryResults();
    const envelope = validLineageV3Envelope();
    const service = new IngestionService(embeddings(), rejectingLlm());

    await service.ingestDocument({
      sourceId: SOURCE_ID,
      title: "lineage-v3",
      content: structuredDocument(envelope)
    });

    const statements = db.client.query.mock.calls.map(([sql]) => normalizeSql(sql));
    expect(statements[0]).toBe("begin");
    expect(statements.some((sql) => sql.startsWith("insert into sources"))).toBe(true);
    expect(statements.at(-1)).toBe("commit");
    expect(db.pool.query).not.toHaveBeenCalled();

    const eventCall = queryCallContaining("insert into events");
    const eventMetadata = JSON.parse(String(eventCall[1][13]));
    expect(eventMetadata).toEqual(expect.objectContaining({
      traceId: expect.any(String),
      sqlLineageEvidence: envelope.evidence
    }));

    const entityCalls = queryCallsContaining("insert into entities");
    const persistedSemantics = entityCalls.map((call) => JSON.parse(String(call[1][8])).lineageSemantics);
    expect(persistedSemantics).toContainEqual({
      role: "temporary",
      sourceSchema: "snw.sql_lineage_event.v3"
    });
    const relationCall = queryCallContaining("insert into lineage_relations");
    expect(relationCall[1]).toHaveLength(7);
    expect(relationCall[1][1]).toBe(SOURCE_ID);
    expect(db.client.release).toHaveBeenCalledOnce();
  });

  it("rolls back the entire graph write when a v3 entity role conflicts", async () => {
    installTransactionQueryResults("stage.orders_work");
    const service = new IngestionService(embeddings(), rejectingLlm());

    await expect(service.ingestDocument({
      sourceId: SOURCE_ID,
      title: "lineage-v3-conflict",
      content: structuredDocument(validLineageV3Envelope())
    })).rejects.toBeInstanceOf(LineageSemanticsConflictError);

    const statements = db.client.query.mock.calls.map(([sql]) => normalizeSql(sql));
    expect(statements[0]).toBe("begin");
    expect(statements.at(-1)).toBe("rollback");
    expect(statements).not.toContain("commit");
    expect(db.pool.query).not.toHaveBeenCalled();
    expect(db.client.release).toHaveBeenCalledOnce();
  });
});

function installTransactionQueryResults(conflictEntityName?: string): void {
  db.client.query.mockImplementation(async (sqlValue: unknown, params: unknown[] = []) => {
    const sql = normalizeSql(sqlValue);
    if (sql.includes("insert into sources")) {
      return {
        rows: [{
          id: SOURCE_ID,
          tenant_id: "default",
          name: String(params[2]),
          description: params[3],
          metadata: JSON.parse(String(params[4])),
          archived_at: null,
          created_at: null,
          updated_at: null
        }]
      };
    }
    if (sql.includes("from entity_types")) {
      return { rows: [{ id: "type-1" }] };
    }
    if (sql.includes("insert into entities")) {
      const name = String(params[4]);
      if (name === conflictEntityName) {
        return { rows: [] };
      }
      return { rows: [entityRow(`entity-${name}`, name, JSON.parse(String(params[8])))] };
    }
    return { rows: [] };
  });
}

function queryCallContaining(fragment: string): [unknown, unknown[]] {
  const call = db.client.query.mock.calls.find(([sql]) => normalizeSql(sql).includes(fragment));
  if (!call) throw new Error(`Missing query containing ${fragment}`);
  return call as [unknown, unknown[]];
}

function queryCallsContaining(fragment: string): Array<[unknown, unknown[]]> {
  return db.client.query.mock.calls
    .filter(([sql]) => normalizeSql(sql).includes(fragment)) as Array<[unknown, unknown[]]>;
}

function entityRow(id: string, name: string, metadata: Record<string, unknown>) {
  return {
    id,
    source_id: SOURCE_ID,
    type: "table",
    name,
    normalized_name: name.trim().toLowerCase(),
    metadata
  };
}

function embeddings(): EmbeddingClient {
  return {
    generate: vi.fn(async () => [1, 0]),
    batchGenerate: vi.fn(async (texts: string[]) => texts.map(() => [1, 0]))
  };
}

function rejectingLlm(): LlmClient {
  return {
    extractNamedEntities: vi.fn(async () => []),
    rerankEvents: vi.fn(async () => []),
    extractEventsFromChunk: vi.fn(async () => {
      throw new Error("structured v3 ingestion must not call the LLM");
    })
  };
}

function structuredDocument(envelope: ReturnType<typeof validLineageV3Envelope>): string {
  return `# ${envelope.title}\n\n${envelope.content}\n\n\`\`\`sag-event\n${JSON.stringify(envelope)}\n\`\`\``;
}

function normalizeSql(value: unknown): string {
  return String(value).replace(/\s+/g, " ").trim();
}
