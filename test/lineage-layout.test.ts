import { describe, expect, it } from "vitest";
import { layoutLineageCanvas } from "../web/src/components/lineage-graph/layout.js";
import type {
  LineageCanvasEdge,
  LineageCanvasNode
} from "../web/src/components/lineage-graph/canvas-model.js";

describe("lineage layered layout", () => {
  it("places downstream nodes to the right while preserving semantic dimensions", async () => {
    const upstream = canvasNode("upstream", 240, 92);
    const downstream = canvasNode("downstream", 280, 148);
    const result = await layoutLineageCanvas(
      [upstream, downstream],
      [canvasEdge("edge-1", "upstream", "downstream")]
    );

    const positionedUpstream = result.nodes.find((node) => node.id === "upstream");
    const positionedDownstream = result.nodes.find((node) => node.id === "downstream");
    expect(result.degraded).toBe(false);
    expect(positionedDownstream!.position.x).toBeGreaterThan(positionedUpstream!.position.x);
    expect(positionedUpstream?.width).toBe(240);
    expect(positionedDownstream?.height).toBe(148);
  });

  it("returns a deterministic nonblank fallback when the layout engine fails", async () => {
    const nodes = [canvasNode("a", 200, 60), canvasNode("b", 200, 60)];
    const result = await layoutLineageCanvas(
      nodes,
      [canvasEdge("ab", "a", "b")],
      { layout: async () => { throw new Error("layout failed"); } }
    );

    expect(result.degraded).toBe(true);
    expect(result.error).toContain("layout failed");
    expect(result.nodes).toHaveLength(2);
    expect(new Set(result.nodes.map((node) => `${node.position.x}:${node.position.y}`)).size).toBe(2);
  });

  it("handles an empty graph", async () => {
    const result = await layoutLineageCanvas([], []);
    expect(result).toEqual({ nodes: [], degraded: false });
  });
});

function canvasNode(id: string, width: number, height: number): LineageCanvasNode {
  return {
    id,
    entityId: id,
    kind: "table",
    name: id,
    title: id,
    namespace: "db",
    relationCount: 1,
    columns: [],
    totalColumnCount: 0,
    hiddenColumnCount: 0,
    selected: false,
    related: true,
    loading: false,
    expanded: false,
    width,
    height
  };
}

function canvasEdge(id: string, source: string, target: string): LineageCanvasEdge {
  return {
    id,
    source,
    target,
    sourceHandle: "entity-source",
    targetHandle: "entity-target",
    relationType: "DATA_FLOW",
    relationKind: "table-table",
    label: "数据流",
    showLabel: false,
    eventId: null,
    evidenceCount: 1,
    originalEdgeIds: [id],
    related: true
  };
}
