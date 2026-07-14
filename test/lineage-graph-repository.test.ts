import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock("../src/db/pool.js", () => ({
  pool: db
}));

import { getLineageGraphPage } from "../src/db/repositories.js";

describe("getLineageGraphPage", () => {
  beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue({ rows: [] });
  });

  it("loads only PRODUCES relations for the initial skeleton", async () => {
    const result = await getLineageGraphPage({
      sourceId: "00000000-0000-0000-0000-000000000001",
      tenantId: "default",
      limit: 100
    });

    const sql = normalizeSql(db.query.mock.calls[0][0]);
    expect(sql).toContain("from lineage_relations lr");
    expect(sql).toContain("lr.relation_type = 'PRODUCES'");
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
});

function normalizeSql(value: unknown): string {
  return String(value).replace(/\s+/g, " ").trim();
}
