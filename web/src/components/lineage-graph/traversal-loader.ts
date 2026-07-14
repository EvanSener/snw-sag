import {
  mergeLineageGraphs
} from "../../lib/lineage-graph-model.js";
import type { LineageGraphRecord } from "../../types.js";

export interface LineageTraversalResult {
  graph: LineageGraphRecord;
  expandedNodeIds: Set<string>;
  requestCount: number;
  truncated: boolean;
  cancelled: boolean;
}

export async function loadLineageTraversal(input: {
  graph: LineageGraphRecord;
  selectedNodeId: string;
  depth: number;
  expandedNodeIds: ReadonlySet<string>;
  maxVisibleNodes: number;
  maxRequests: number;
  loadNode: (nodeId: string) => Promise<LineageGraphRecord>;
  shouldContinue: () => boolean;
  onNodeLoading: (nodeId: string, loading: boolean) => void;
  onProgress: (graph: LineageGraphRecord, expandedNodeIds: ReadonlySet<string>) => void;
}): Promise<LineageTraversalResult> {
  let graph = input.graph;
  const expandedNodeIds = new Set(input.expandedNodeIds);
  const visitedNodeIds = new Set<string>();
  let frontier = [input.selectedNodeId];
  let requestCount = 0;
  let truncated = false;
  if (graph.nodes.length >= input.maxVisibleNodes) {
    return { graph, expandedNodeIds, requestCount, truncated: true, cancelled: false };
  }

  for (let level = 0; level < input.depth && frontier.length > 0; level += 1) {
    const nextFrontier = new Set<string>();
    for (const nodeId of frontier) {
      if (!input.shouldContinue()) {
        return { graph, expandedNodeIds, requestCount, truncated, cancelled: true };
      }
      visitedNodeIds.add(nodeId);
      let reachedNodeLimit = false;
      if (!expandedNodeIds.has(nodeId)) {
        if (requestCount >= input.maxRequests) {
          truncated = true;
          return { graph, expandedNodeIds, requestCount, truncated, cancelled: false };
        }
        input.onNodeLoading(nodeId, true);
        try {
          const page = await input.loadNode(nodeId);
          if (!input.shouldContinue()) {
            return { graph, expandedNodeIds, requestCount, truncated, cancelled: true };
          }
          graph = mergeLineageGraphs(graph, page, input.maxVisibleNodes);
          expandedNodeIds.add(nodeId);
          requestCount += 1;
          reachedNodeLimit = graph.nodes.length >= input.maxVisibleNodes;
          truncated ||= page.hasMore || reachedNodeLimit;
          input.onProgress(graph, expandedNodeIds);
        } finally {
          input.onNodeLoading(nodeId, false);
        }
      }
      if (reachedNodeLimit) {
        return { graph, expandedNodeIds, requestCount, truncated: true, cancelled: false };
      }

      for (const edge of graph.edges) {
        const neighborId = edge.sourceId === nodeId
          ? edge.targetId
          : edge.targetId === nodeId
            ? edge.sourceId
            : null;
        if (neighborId && !visitedNodeIds.has(neighborId)) {
          nextFrontier.add(neighborId);
        }
      }
    }
    frontier = [...nextFrontier];
  }

  return { graph, expandedNodeIds, requestCount, truncated, cancelled: false };
}
