import { describe, expect, it } from "vitest";
import {
  buildLineageCanvasModel,
  relationDisplayLabel
} from "../web/src/components/lineage-graph/canvas-model.js";
import type { LineageGraphRecord } from "../web/src/types.js";

describe("lineage canvas model", () => {
  it("groups owned columns into table cards and keeps orphan columns visible", () => {
    const model = buildLineageCanvasModel(fixtureGraph(), {
      expandedTableIds: new Set(),
      maxCollapsedColumns: 1,
      maxExpandedColumns: 4,
      selectedNodeId: null,
      neighborhood: null,
      showRelationLabels: false,
      language: "zh"
    });

    expect(model.nodes.map((node) => node.id).sort()).toEqual([
      "column-orphan",
      "table-orders",
      "table-summary",
      "task-build"
    ]);
    expect(model.ownerTableByColumnId.get("column-amount")).toBe("table-orders");
    expect(model.ownerTableByColumnId.has("column-orphan")).toBe(false);

    const orders = model.nodes.find((node) => node.id === "table-orders");
    expect(orders?.kind).toBe("table");
    expect(orders?.columns).toEqual([
      expect.objectContaining({ id: "column-id", name: "id" })
    ]);
    expect(orders?.hiddenColumnCount).toBe(1);
    expect(model.edges.some((edge) => edge.relationType === "HAS_COLUMN")).toBe(false);
  });

  it("keeps a selected field visible and maps field lineage to row handles", () => {
    const model = buildLineageCanvasModel(fixtureGraph(), {
      expandedTableIds: new Set(),
      maxCollapsedColumns: 1,
      maxExpandedColumns: 4,
      selectedNodeId: "column-id",
      neighborhood: {
        nodeIds: new Set(["column-id", "column-total"]),
        edgeIds: new Set(["edge-column-lineage"])
      },
      showRelationLabels: false,
      language: "zh"
    });

    const orders = model.nodes.find((node) => node.id === "table-orders");
    expect(orders?.selected).toBe(true);
    expect(orders?.columns.map((column) => column.id)).toContain("column-id");

    expect(model.edges).toEqual([
      expect.objectContaining({
        source: "table-orders",
        target: "table-summary",
        sourceHandle: "field-source-column-id",
        targetHandle: "field-target-column-total",
        relationType: "COLUMN_LINEAGE",
        showLabel: true,
        related: true
      })
    ]);
  });

  it("suppresses automatic non-join labels for a dense focused subgraph", () => {
    const edgeIds = new Set(["edge-column-lineage"]);
    for (let index = 0; index < 30; index += 1) edgeIds.add(`dense-${index}`);
    const model = buildLineageCanvasModel(fixtureGraph(), {
      expandedTableIds: new Set(),
      maxCollapsedColumns: 1,
      maxExpandedColumns: 4,
      selectedNodeId: "column-id",
      neighborhood: {
        nodeIds: new Set(["column-id", "column-total"]),
        edgeIds
      },
      showRelationLabels: false,
      language: "zh"
    });

    expect(model.edges.find((edge) => edge.relationType === "COLUMN_LINEAGE")?.showLabel).toBe(false);
  });

  it("shows the expanded field budget for the requested table", () => {
    const model = buildLineageCanvasModel(fixtureGraph(), {
      expandedTableIds: new Set(["table-orders"]),
      maxCollapsedColumns: 1,
      maxExpandedColumns: 4,
      selectedNodeId: null,
      neighborhood: null,
      showRelationLabels: false,
      language: "zh"
    });

    const orders = model.nodes.find((node) => node.id === "table-orders");
    expect(orders?.expanded).toBe(true);
    expect(orders?.columns.map((column) => column.id).sort()).toEqual([
      "column-amount",
      "column-id"
    ]);
    expect(orders?.hiddenColumnCount).toBe(0);
  });

  it("renders join types literally and translates other relation labels", () => {
    expect(relationDisplayLabel("LEFT_JOIN", "zh")).toBe("LEFT JOIN");
    expect(relationDisplayLabel("FULL_OUTER_JOIN", "en")).toBe("FULL OUTER JOIN");
    expect(relationDisplayLabel("DATA_FLOW", "zh")).toBe("数据流");
    expect(relationDisplayLabel("PRODUCES", "en")).toBe("Produces");
  });
});

function fixtureGraph(): LineageGraphRecord {
  return {
    available: true,
    view: "answer",
    graphRevision: "fixture-revision",
    evidencePathSummaries: [],
    stats: {
      evidenceLoadedNodes: 7,
      evidenceLoadedEdges: 6,
      answerNodes: 7,
      answerEdges: 6,
      semanticHiddenNodes: 0,
      semanticHiddenEdges: 0
    },
    hasMore: false,
    nodes: [
      node("task-build", "task", "build_summary"),
      node("table-orders", "table", "ods.orders"),
      node("table-summary", "table", "dws.order_summary"),
      node("column-id", "column", "ods.orders.id"),
      node("column-amount", "column", "ods.orders.amount"),
      node("column-total", "column", "dws.order_summary.total"),
      node("column-orphan", "column", "unowned_value")
    ],
    edges: [
      edge("edge-orders-id", "table-orders", "column-id", "HAS_COLUMN"),
      edge("edge-orders-amount", "table-orders", "column-amount", "HAS_COLUMN"),
      edge("edge-summary-total", "table-summary", "column-total", "HAS_COLUMN"),
      edge("edge-column-lineage", "column-id", "column-total", "COLUMN_LINEAGE"),
      edge("edge-join", "table-orders", "table-summary", "LEFT_JOIN"),
      edge("edge-produces", "task-build", "table-summary", "PRODUCES")
    ]
  };
}

function node(id: string, type: "task" | "table" | "column", name: string): LineageGraphRecord["nodes"][number] {
  return { id, sourceId: "project-1", type, name, normalizedName: name, relationCount: 2 };
}

function edge(id: string, sourceId: string, targetId: string, type: string): LineageGraphRecord["edges"][number] {
  return { id, sourceId, targetId, type, eventId: `${id}-event`, evidenceCount: 1 };
}
