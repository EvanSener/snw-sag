import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock("../src/db/pool.js", () => ({
  pool: db
}));

import { getLineageGraphPage, listEventsByDocument } from "../src/db/repositories.js";

describe("getLineageGraphPage", () => {
  beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue({ rows: [] });
  });

  it("loads PRODUCES relations and inferred task dependencies for the initial skeleton", async () => {
    const result = await getLineageGraphPage({
      sourceId: "00000000-0000-0000-0000-000000000001",
      tenantId: "default",
      limit: 100
    });

    const sql = normalizeSql(db.query.mock.calls[0][0]);
    expect(sql).toContain("from lineage_relations lr");
    expect(sql).toContain("task_dependencies as");
    expect(sql).toContain("producer.source_entity_id <> flow.context_task_entity_id");
    expect(sql).toContain("relation_type in ('PRODUCES', 'DEPENDS_ON')");
    expect(sql).toContain("limit $3");
    expect(result).toEqual({ available: false, nodes: [], edges: [], hasMore: false });
  });

  it("loads only one-hop incoming and outgoing relations for a node", async () => {
    await getLineageGraphPage({
      sourceId: "00000000-0000-0000-0000-000000000001",
      tenantId: "default",
      nodeId: "00000000-0000-0000-0000-000000000011",
      limit: 80
    });

    const sql = normalizeSql(db.query.mock.calls[0][0]);
    expect(sql).toContain("lr.source_entity_id = $3");
    expect(sql).toContain("lr.target_entity_id = $3");
    expect(sql).toContain("lr.context_task_entity_id = $3");
    expect(sql).toContain("limit $4");
  });

  it("uses normalized entity text search without loading all relations", async () => {
    await getLineageGraphPage({
      sourceId: "00000000-0000-0000-0000-000000000001",
      tenantId: "default",
      query: "db.orders",
      limit: 20
    });

    const sql = normalizeSql(db.query.mock.calls[0][0]);
    expect(sql).toContain("from entities ent");
    expect(sql).toContain("ent.normalized_name ilike");
    expect(sql).toContain("limit $4");
  });

  it("keeps context tasks on edges without returning isolated task nodes", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: "relation-1",
        source_entity_id: "table-a",
        source_id: "project-1",
        source_type: "table",
        source_name: "db.a",
        source_normalized_name: "db.a",
        target_entity_id: "table-b",
        target_type: "table",
        target_name: "db.b",
        target_normalized_name: "db.b",
        relation_type: "DATA_FLOW",
        context_task_entity_id: "task-context",
        context_task_name: "build_b",
        event_id: "event-1",
        evidence_count: 1
      }]
    });

    const result = await getLineageGraphPage({
      sourceId: "00000000-0000-0000-0000-000000000001",
      tenantId: "default",
      nodeId: "00000000-0000-0000-0000-000000000011",
      limit: 80
    });

    expect(result.nodes.map((node) => node.name)).toEqual(["db.a", "db.b"]);
    expect(result.edges[0]).toMatchObject({
      contextTaskId: "task-context",
      contextTaskName: "build_b"
    });
  });

  it("returns inferred task-to-task dependency edges", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: "task-dependency:task-a:task-b",
        source_entity_id: "task-a",
        source_id: "project-1",
        source_type: "task",
        source_name: "build_a",
        source_normalized_name: "build_a",
        target_entity_id: "task-b",
        target_type: "task",
        target_name: "build_b",
        target_normalized_name: "build_b",
        relation_type: "DEPENDS_ON",
        context_task_entity_id: null,
        context_task_name: null,
        event_id: "event-1",
        evidence_count: 2
      }]
    });

    const result = await getLineageGraphPage({
      sourceId: "00000000-0000-0000-0000-000000000001",
      tenantId: "default",
      limit: 100
    });

    expect(result.nodes.map((node) => node.type)).toEqual(["task", "task"]);
    expect(result.edges[0]).toMatchObject({
      id: "task-dependency:task-a:task-b",
      sourceId: "task-a",
      targetId: "task-b",
      type: "DEPENDS_ON",
      evidenceCount: 2
    });
  });

  it("exposes event categories in document results", async () => {
    db.query.mockResolvedValueOnce({
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

    expect(normalizeSql(db.query.mock.calls[0][0])).toContain("e.category");
    expect(events[0].category).toBe("COLUMN_TO_COLUMN_LINEAGE");
  });
});

function normalizeSql(value: unknown): string {
  return String(value).replace(/\s+/g, " ").trim();
}
