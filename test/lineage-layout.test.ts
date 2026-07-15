import { describe, expect, it } from "vitest";
import { layoutLineageCanvas } from "../web/src/components/lineage-graph/layout.js";
import { edgePointsToPath } from "../web/src/components/lineage-graph/orthogonal-edge-path.js";
import type {
  LineageCanvasEdge,
  LineageCanvasNode
} from "../web/src/components/lineage-graph/canvas-model.js";

describe("lineage layered layout", () => {
  it("renders audited ELK points as an exact orthogonal SVG path", () => {
    expect(edgePointsToPath([
      { x: 100, y: 40 },
      { x: 320, y: 40 },
      { x: 320, y: 180 },
      { x: 500, y: 180 }
    ])).toBe("M 100 40 L 320 40 L 320 180 L 500 180");
  });

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
    expect(result).toEqual({ nodes: [], edges: [], bundledEdgeIds: [], degraded: false });
  });

  it("preserves ELK orthogonal edge sections for rendering", async () => {
    const result = await layoutLineageCanvas(
      [canvasNode("a", 100, 60), canvasNode("b", 100, 60)],
      [canvasEdge("ab", "a", "b")],
      { layout: async () => ({
        id: "root",
        children: [
          { id: "a", x: 0, y: 0, width: 100, height: 60 },
          { id: "b", x: 200, y: 80, width: 100, height: 60 }
        ],
        edges: [{
          id: "ab",
          sources: ["a"],
          targets: ["b"],
          sections: [{
            id: "ab-section",
            startPoint: { x: 100, y: 30 },
            bendPoints: [{ x: 150, y: 30 }, { x: 150, y: 110 }],
            endPoint: { x: 200, y: 110 }
          }]
        }]
      }) }
    );

    expect(result.edges[0].points).toEqual([
      { x: 100, y: 30 },
      { x: 150, y: 30 },
      { x: 150, y: 110 },
      { x: 200, y: 110 }
    ]);
    expect(result.bundledEdgeIds).toEqual([]);
  });

  it("moves a known crossing relation into the evidence bundle", async () => {
    const result = await layoutLineageCanvas(
      [
        canvasNode("a", 20, 20),
        canvasNode("b", 20, 20),
        canvasNode("c", 20, 20),
        canvasNode("d", 20, 20)
      ],
      [canvasEdge("horizontal", "a", "b"), canvasEdge("vertical", "c", "d")],
      { layout: async () => ({
        id: "root",
        children: [
          { id: "a", x: 0, y: 40, width: 20, height: 20 },
          { id: "b", x: 100, y: 40, width: 20, height: 20 },
          { id: "c", x: 50, y: 0, width: 20, height: 20 },
          { id: "d", x: 50, y: 100, width: 20, height: 20 }
        ],
        edges: [
          { id: "horizontal", sources: ["a"], targets: ["b"], sections: [{
            id: "h", startPoint: { x: 20, y: 50 }, endPoint: { x: 100, y: 50 }
          }] },
          { id: "vertical", sources: ["c"], targets: ["d"], sections: [{
            id: "v", startPoint: { x: 60, y: 20 }, endPoint: { x: 60, y: 100 }
          }] }
        ]
      }) }
    );

    expect(result.edges.map((edge) => edge.id)).toEqual(["horizontal"]);
    expect(result.bundledEdgeIds).toEqual(["vertical"]);
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
