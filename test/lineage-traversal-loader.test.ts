import { describe, expect, it, vi } from "vitest";
import { loadLineageTraversal } from "../web/src/components/lineage-graph/traversal-loader.js";
import type { LineageGraphRecord } from "../web/src/types.js";

describe("lineage traversal loader", () => {
  it("loads breadth-first frontiers up to the requested depth", async () => {
    const loadNode = vi.fn(async (nodeId: string) => {
      if (nodeId === "a") return graph([node("a"), node("b")], [edge("ab", "a", "b")]);
      if (nodeId === "b") return graph([node("b"), node("c")], [edge("bc", "b", "c")]);
      return graph([], []);
    });

    const result = await loadLineageTraversal({
      graph: graph([node("a")], []),
      selectedNodeId: "a",
      depth: 2,
      expandedNodeIds: new Set(),
      maxVisibleNodes: 20,
      maxRequests: 10,
      loadNode,
      shouldContinue: () => true,
      onNodeLoading: () => undefined,
      onProgress: () => undefined
    });

    expect(loadNode.mock.calls.map(([nodeId]) => nodeId)).toEqual(["a", "b"]);
    expect(result.graph.nodes.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(result.graph.edges.map((item) => item.id)).toEqual(["ab", "bc"]);
    expect([...result.expandedNodeIds]).toEqual(["a", "b"]);
    expect(result.truncated).toBe(false);
  });

  it("stops when the request budget is exhausted", async () => {
    const loadNode = vi.fn(async () => graph([node("a"), node("b")], [edge("ab", "a", "b")]));
    const result = await loadLineageTraversal({
      graph: graph([node("a")], []),
      selectedNodeId: "a",
      depth: 3,
      expandedNodeIds: new Set(),
      maxVisibleNodes: 20,
      maxRequests: 1,
      loadNode,
      shouldContinue: () => true,
      onNodeLoading: () => undefined,
      onProgress: () => undefined
    });

    expect(loadNode).toHaveBeenCalledTimes(1);
    expect(result.truncated).toBe(true);
    expect(result.cancelled).toBe(false);
  });

  it("does not request more nodes after reaching the visible node limit", async () => {
    const loadNode = vi.fn(async () => graph([], []));
    const result = await loadLineageTraversal({
      graph: graph([node("a"), node("b")], [edge("ab", "a", "b")]),
      selectedNodeId: "a",
      depth: 2,
      expandedNodeIds: new Set(),
      maxVisibleNodes: 2,
      maxRequests: 10,
      loadNode,
      shouldContinue: () => true,
      onNodeLoading: () => undefined,
      onProgress: () => undefined
    });

    expect(loadNode).not.toHaveBeenCalled();
    expect(result.truncated).toBe(true);
  });

  it("discards a loaded page when a newer traversal cancels the run", async () => {
    let continueChecks = 0;
    const loadNode = vi.fn(async () => graph([node("a"), node("b")], [edge("ab", "a", "b")]));
    const result = await loadLineageTraversal({
      graph: graph([node("a")], []),
      selectedNodeId: "a",
      depth: 2,
      expandedNodeIds: new Set(),
      maxVisibleNodes: 20,
      maxRequests: 10,
      loadNode,
      shouldContinue: () => continueChecks++ === 0,
      onNodeLoading: () => undefined,
      onProgress: () => undefined
    });

    expect(loadNode).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
    expect(result.graph.nodes.map((item) => item.id)).toEqual(["a"]);
    expect([...result.expandedNodeIds]).toEqual([]);
  });
});

function graph(nodes: LineageGraphRecord["nodes"], edges: LineageGraphRecord["edges"]): LineageGraphRecord {
  return { available: true, hasMore: false, nodes, edges };
}

function node(id: string): LineageGraphRecord["nodes"][number] {
  return {
    id,
    sourceId: "project-1",
    type: "task",
    name: id,
    normalizedName: id,
    relationCount: 1
  };
}

function edge(id: string, sourceId: string, targetId: string): LineageGraphRecord["edges"][number] {
  return { id, sourceId, targetId, type: "DEPENDS_ON", evidenceCount: 1 };
}
