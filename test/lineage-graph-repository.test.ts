import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../src/db/pool.js", () => ({
  pool: db.pool
}));

import { getLineageEvidenceSnapshot } from "../src/db/lineage-repository.js";
import { listEventsByDocument } from "../src/db/repositories.js";

const SOURCE_ID = "00000000-0000-0000-0000-000000000001";
const TENANT_ID = "tenant-a";

describe("getLineageEvidenceSnapshot", () => {
  beforeEach(() => {
    db.client.query.mockReset();
    db.client.release.mockReset();
    db.pool.query.mockReset();
    db.pool.connect.mockReset();
    db.pool.connect.mockResolvedValue(db.client);
  });

  it("loads a stable active evidence snapshot in one read-only transaction", async () => {
    db.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SOURCE_ID }] })
      .mockResolvedValueOnce({ rows: [
        lineageNodeRow("node-z", "stage.tmp_orders", {
          lineageSemantics: {
            role: "temporary",
            sourceSchema: "snw.sql_lineage_event.v3"
          }
        }, 2),
        lineageNodeRow("node-a", "raw.orders", { owner: "warehouse" }, 1),
        lineageNodeRow("node-m", "stage.cast_orders", {
          lineageSemantics: { role: "evidence_only" }
        }, 3)
      ] })
      .mockResolvedValueOnce({ rows: [
        lineageEdgeRow({
          id: "edge-z",
          sourceId: "node-m",
          targetId: "node-z",
          eventId: "event-z",
          eventMetadata: {
            relativePath: "must-not-be-read.sql",
            statementId: "must-not-be-read",
            sqlLineageEvidence: {
              relativePath: "models/z.sql",
              statementId: `stmt:${"z".repeat(64)}`
            }
          }
        }),
        lineageEdgeRow({
          id: "edge-a",
          sourceId: "node-a",
          targetId: "node-m",
          eventId: "event-a",
          contextTaskId: "task-a",
          contextTaskName: "build_orders",
          eventMetadata: {
            sqlLineageEvidence: {
              relativePath: "models/a.sql",
              statementId: `stmt:${"a".repeat(64)}`
            }
          }
        })
      ] })
      .mockResolvedValueOnce({ rows: [] });

    const snapshot = await getLineageEvidenceSnapshot({
      sourceId: SOURCE_ID,
      tenantId: TENANT_ID
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot).toMatchObject({
      tenantId: TENANT_ID,
      projectId: SOURCE_ID,
      available: true
    });
    expect(snapshot?.graphRevision).toMatch(/^sagrev:[0-9a-f]{64}$/);
    expect(snapshot?.nodes).toEqual([
      expect.objectContaining({
        id: "node-a",
        role: "business",
        roleSource: "legacy-default",
        relationCount: 1
      }),
      expect.objectContaining({
        id: "node-m",
        role: "evidence_only",
        roleSource: "declared",
        relationCount: 3
      }),
      expect.objectContaining({
        id: "node-z",
        role: "temporary",
        roleSource: "declared",
        relationCount: 2
      })
    ]);
    expect(snapshot?.edges.map((edge) => edge.id)).toEqual(["edge-a", "edge-z"]);
    expect(snapshot?.edges[0]).toMatchObject({
      sourceId: "node-a",
      targetId: "node-m",
      type: "DATA_FLOW",
      contextTaskId: "task-a",
      contextTaskName: "build_orders",
      eventId: "event-a",
      eventIds: ["event-a"],
      evidenceCount: 1,
      events: [{
        id: "event-a",
        title: "Evidence event-a",
        summary: "event summary",
        relativePath: "models/a.sql",
        statementId: `stmt:${"a".repeat(64)}`
      }]
    });
    expect(snapshot?.edges[1].events[0]).toMatchObject({
      relativePath: "models/z.sql",
      statementId: `stmt:${"z".repeat(64)}`
    });

    const statements = db.client.query.mock.calls.map(([sql]) => normalizeSql(sql));
    expect(statements[0]).toBe("begin isolation level repeatable read read only");
    expect(statements[1]).toContain("from sources s");
    expect(statements[1]).toContain("s.id = $1");
    expect(statements[1]).toContain("s.tenant_id = $2");
    expect(statements[1]).toContain("s.archived_at is null");

    const nodesSql = statements[2];
    expect(nodesSql).toContain("ent.metadata as entity_metadata");
    expect(nodesSql).toContain("s.tenant_id = $2");
    expect(nodesSql).toContain("s.archived_at is null");
    expect(nodesSql).toContain("d.archived_at is null");
    expect(nodesSql).toContain("e.deleted_at is null");
    expect(nodesSql).toContain("e.source_id = lr.source_id");
    expect(nodesSql).toContain("d.source_id = lr.source_id");
    expect(nodesSql).toContain("source_ent.source_id = lr.source_id");
    expect(nodesSql).toContain("target_ent.source_id = lr.source_id");
    expect(nodesSql).toContain("ent.source_id = $1");

    const edgesSql = statements[3];
    expect(edgesSql).toContain("from lineage_relations lr");
    expect(edgesSql).toContain("e.metadata as event_metadata");
    expect(edgesSql).toContain("s.tenant_id = $2");
    expect(edgesSql).toContain("s.archived_at is null");
    expect(edgesSql).toContain("d.archived_at is null");
    expect(edgesSql).toContain("e.deleted_at is null");
    expect(edgesSql).toContain("e.source_id = lr.source_id");
    expect(edgesSql).toContain("d.source_id = lr.source_id");
    expect(edgesSql).toContain("source_ent.source_id = lr.source_id");
    expect(edgesSql).toContain("target_ent.source_id = lr.source_id");
    expect(edgesSql).toContain("context_ent.id as context_task_entity_id");
    expect(edgesSql).toContain("context_ent.source_id = lr.source_id");
    expect(statements.join(" ")).not.toContain("task_dependencies as");
    expect(statements.at(-1)).toBe("commit");
    expect(db.pool.query).not.toHaveBeenCalled();
    expect(db.client.release).toHaveBeenCalledOnce();
  });

  it("returns null without reading graph rows when the active project is unavailable", async () => {
    db.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(getLineageEvidenceSnapshot({
      sourceId: SOURCE_ID,
      tenantId: "other-tenant"
    })).resolves.toBeNull();

    const statements = db.client.query.mock.calls.map(([sql]) => normalizeSql(sql));
    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe("begin isolation level repeatable read read only");
    expect(statements[1]).toContain("s.tenant_id = $2");
    expect(statements[1]).toContain("s.archived_at is null");
    expect(statements[2]).toBe("commit");
    expect(db.client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the client when a snapshot query fails", async () => {
    db.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SOURCE_ID }] })
      .mockRejectedValueOnce(new Error("snapshot read failed"))
      .mockResolvedValueOnce({ rows: [] });

    await expect(getLineageEvidenceSnapshot({
      sourceId: SOURCE_ID,
      tenantId: TENANT_ID
    })).rejects.toThrow("snapshot read failed");

    const statements = db.client.query.mock.calls.map(([sql]) => normalizeSql(sql));
    expect(statements.at(-1)).toBe("rollback");
    expect(statements).not.toContain("commit");
    expect(db.client.release).toHaveBeenCalledOnce();
  });
});

describe("listEventsByDocument", () => {
  beforeEach(() => {
    db.pool.query.mockReset();
    db.pool.query.mockResolvedValue({ rows: [] });
  });

  it("exposes event categories in document results", async () => {
    db.pool.query.mockResolvedValueOnce({
      rows: [{
        id: "event-1",
        source_id: "project-1",
        document_id: "document-1",
        chunk_id: "chunk-1",
        title: "字段级血缘",
        summary: "",
        content: "column lineage",
        category: "COLUMN_TO_COLUMN_LINEAGE",
        rank: 1,
        entity_count: 0,
        entities: []
      }]
    });

    const events = await listEventsByDocument({
      documentId: "00000000-0000-0000-0000-000000000010",
      tenantId: "default"
    });

    expect(normalizeSql(db.pool.query.mock.calls[0][0])).toContain("e.category");
    expect(events[0].category).toBe("COLUMN_TO_COLUMN_LINEAGE");
  });
});

function lineageNodeRow(
  id: string,
  name: string,
  metadata: Record<string, unknown>,
  relationCount: number
) {
  return {
    id,
    source_id: SOURCE_ID,
    type: "table",
    name,
    normalized_name: name.toLowerCase(),
    relation_count: relationCount,
    entity_metadata: metadata
  };
}

function lineageEdgeRow(input: {
  id: string;
  sourceId: string;
  targetId: string;
  eventId: string;
  eventMetadata: Record<string, unknown>;
  contextTaskId?: string;
  contextTaskName?: string;
}) {
  return {
    id: input.id,
    source_entity_id: input.sourceId,
    target_entity_id: input.targetId,
    relation_type: "DATA_FLOW",
    context_task_entity_id: input.contextTaskId ?? null,
    context_task_name: input.contextTaskName ?? null,
    event_id: input.eventId,
    event_title: `Evidence ${input.eventId}`,
    event_summary: "event summary",
    event_metadata: input.eventMetadata
  };
}

function normalizeSql(value: unknown): string {
  return String(value).replace(/\s+/g, " ").trim();
}
