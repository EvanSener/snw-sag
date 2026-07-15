import { describe, expect, it } from "vitest";
import {
  collectLineageNeighborhood,
  filterLineageGraph,
  mergeLineageGraphs,
  relationKindForEdge,
  type LineageRelationKind
} from "../web/src/lib/lineage-graph-model.js";
import type { LineageGraphRecord } from "../web/src/types.js";

const graph: LineageGraphRecord = {
  available: true,
  view: "answer",
  graphRevision: "fixture-revision",
  evidencePathSummaries: [],
  stats: {
    evidenceLoadedNodes: 6,
    evidenceLoadedEdges: 5,
    answerNodes: 6,
    answerEdges: 5,
    semanticHiddenNodes: 0,
    semanticHiddenEdges: 0
  },
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

  it("collects only the selected entity neighborhood up to the requested depth", () => {
    const chain: LineageGraphRecord = {
      available: true,
      view: "answer",
      graphRevision: "fixture-revision",
      evidencePathSummaries: [],
      stats: {
        evidenceLoadedNodes: 6,
        evidenceLoadedEdges: 4,
        answerNodes: 6,
        answerEdges: 4,
        semanticHiddenNodes: 0,
        semanticHiddenEdges: 0
      },
      hasMore: false,
      nodes: [
        node("a", "task"),
        node("b", "task"),
        node("c", "task"),
        node("d", "task"),
        node("x", "task"),
        node("y", "task")
      ],
      edges: [
        edge("ab", "a", "b", "DEPENDS_ON"),
        edge("bc", "b", "c", "DEPENDS_ON"),
        edge("cd", "c", "d", "DEPENDS_ON"),
        edge("xy", "x", "y", "DEPENDS_ON")
      ]
    };

    const direct = collectLineageNeighborhood(chain, "b", 1);
    expect([...direct.nodeIds].sort()).toEqual(["a", "b", "c"]);
    expect([...direct.edgeIds].sort()).toEqual(["ab", "bc"]);

    const indirect = collectLineageNeighborhood(chain, "b", 2);
    expect([...indirect.nodeIds].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...indirect.edgeIds].sort()).toEqual(["ab", "bc", "cd"]);

    const missing = collectLineageNeighborhood(chain, "missing", 2);
    expect([...missing.nodeIds]).toEqual([]);
    expect([...missing.edgeIds]).toEqual([]);
  });

  it("rejects merges across graph views", () => {
    expect(() => mergeLineageGraphs(
      mergeGraph({ view: "answer" }),
      mergeGraph({ view: "evidence" }),
      10
    )).toThrow("Cannot merge lineage graphs with different views");
  });

  it("rejects merges across graph revisions", () => {
    expect(() => mergeLineageGraphs(
      mergeGraph({ graphRevision: "revision-1" }),
      mergeGraph({ graphRevision: "revision-2" }),
      10
    )).toThrow("Cannot merge lineage graphs with different revisions");
  });

  it("deduplicates path summaries and takes monotonic stats while merging pages", () => {
    const current = mergeGraph({
      nodes: [node("a", "task"), node("b", "task")],
      edges: [edge("ab", "a", "b", "DEPENDS_ON")],
      evidencePathSummaries: [summary("path-a", "current-a"), summary("path-b", "current-b")],
      stats: {
        evidenceLoadedNodes: 2,
        evidenceLoadedEdges: 3,
        answerNodes: 2,
        answerEdges: 1,
        semanticHiddenNodes: 4,
        semanticHiddenEdges: 2
      }
    });
    const page = mergeGraph({
      nodes: [node("b", "task"), node("c", "task"), node("d", "task")],
      edges: [
        edge("bc", "b", "c", "DEPENDS_ON"),
        edge("cd", "c", "d", "DEPENDS_ON")
      ],
      evidencePathSummaries: [
        summary("path-b", "page-b"),
        summary("path-c", "page-c")
      ],
      stats: {
        evidenceLoadedNodes: 5,
        evidenceLoadedEdges: 2,
        answerNodes: 4,
        answerEdges: 3,
        semanticHiddenNodes: 3,
        semanticHiddenEdges: 6
      }
    });

    const merged = mergeLineageGraphs(current, page, 3);

    expect(merged.nodes.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(merged.edges.map((item) => item.id)).toEqual(["ab", "bc"]);
    expect(merged.hasMore).toBe(true);
    expect(merged.evidencePathSummaries.map((item) => item.pathId)).toEqual([
      "path-a",
      "path-b",
      "path-c"
    ]);
    expect(merged.evidencePathSummaries[1]).toEqual(summary("path-b", "page-b"));
    expect(merged.stats).toEqual({
      evidenceLoadedNodes: 5,
      evidenceLoadedEdges: 3,
      answerNodes: 4,
      answerEdges: 3,
      semanticHiddenNodes: 4,
      semanticHiddenEdges: 6
    });
  });
});

function mergeGraph(overrides: Partial<LineageGraphRecord> = {}): LineageGraphRecord {
  return {
    ...graph,
    view: "answer",
    graphRevision: "revision-1",
    nodes: [node("seed", "task")],
    edges: [],
    evidencePathSummaries: [],
    stats: {
      evidenceLoadedNodes: 1,
      evidenceLoadedEdges: 0,
      answerNodes: 1,
      answerEdges: 0,
      semanticHiddenNodes: 0,
      semanticHiddenEdges: 0
    },
    ...overrides
  };
}

function summary(pathId: string, eventId: string): LineageGraphRecord["evidencePathSummaries"][number] {
  return {
    pathId,
    sourceNodeId: "source",
    targetNodeId: "target",
    hiddenNodeCount: 1,
    relationTypes: ["DATA_FLOW"],
    evidenceCount: 1,
    eventIds: [eventId]
  };
}

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
