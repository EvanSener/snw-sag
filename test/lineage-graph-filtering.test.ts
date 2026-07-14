import { describe, expect, it } from "vitest";
import {
  filterLineageGraph,
  relationKindForEdge,
  type LineageRelationKind
} from "../web/src/lib/lineage-graph-model.js";
import type { LineageGraphRecord } from "../web/src/types.js";

const graph: LineageGraphRecord = {
  available: true,
  hasMore: false,
  nodes: [
    node("task-a", "task"),
    node("task-b", "task"),
    node("table-a", "table"),
    node("table-b", "table"),
    node("column-a", "column"),
    node("column-b", "column")
  ],
  edges: [
    edge("task-task", "task-a", "task-b", "DEPENDS_ON"),
    edge("task-table", "task-a", "table-a", "PRODUCES"),
    edge("table-table", "table-a", "table-b", "DATA_FLOW"),
    edge("table-column", "table-b", "column-b", "HAS_COLUMN"),
    edge("column-column", "column-a", "column-b", "DERIVED_FROM")
  ]
};

describe("lineage graph filtering", () => {
  it("classifies all five supported endpoint relationship kinds", () => {
    const nodeTypes = new Map(graph.nodes.map((item) => [item.id, item.type]));
    expect(graph.edges.map((item) => relationKindForEdge(item, nodeTypes))).toEqual([
      "task-task",
      "task-table",
      "table-table",
      "table-column",
      "column-column"
    ]);
  });

  it("filters entity and relationship visibility without mutating loaded data", () => {
    const visibleRelationKinds = new Set<LineageRelationKind>(["task-task", "task-table"]);
    const filtered = filterLineageGraph(graph, {
      entityTypes: new Set(["task", "table"]),
      relationKinds: visibleRelationKinds
    });

    expect(filtered.nodes.map((item) => item.id)).toEqual(["task-a", "task-b", "table-a", "table-b"]);
    expect(filtered.edges.map((item) => item.id)).toEqual(["task-task", "task-table"]);
    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges).toHaveLength(5);
  });

  it("drops edges whose endpoint type is hidden", () => {
    const filtered = filterLineageGraph(graph, {
      entityTypes: new Set(["table"]),
      relationKinds: new Set<LineageRelationKind>(["table-table", "task-table"])
    });

    expect(filtered.nodes.map((item) => item.id)).toEqual(["table-a", "table-b"]);
    expect(filtered.edges.map((item) => item.id)).toEqual(["table-table"]);
  });
});

function node(id: string, type: "task" | "table" | "column") {
  return {
    id,
    sourceId: "project-1",
    type,
    name: id,
    normalizedName: id,
    relationCount: 1
  };
}

function edge(id: string, sourceId: string, targetId: string, type: string) {
  return {
    id,
    sourceId,
    targetId,
    type,
    evidenceCount: 1
  };
}
