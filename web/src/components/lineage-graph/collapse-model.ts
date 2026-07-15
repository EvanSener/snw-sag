import type { LineageGraphRecord } from "../../types.js";

export interface LineageCollapseState {
  upstreamNodeIds: ReadonlySet<string>;
  downstreamNodeIds: ReadonlySet<string>;
}

export function collapseLineageGraph(
  graph: LineageGraphRecord,
  state: LineageCollapseState
): LineageGraphRecord {
  if (state.upstreamNodeIds.size === 0 && state.downstreamNodeIds.size === 0) return graph;

  const traversableEdges = graph.edges.filter((edge) => edge.type !== "HAS_COLUMN");
  const removedEdgeIds = new Set<string>();
  const candidateNodeIds = new Set<string>();
  const roots = new Set([...state.upstreamNodeIds, ...state.downstreamNodeIds]);

  for (const root of state.upstreamNodeIds) {
    collectBranch(root, "upstream", traversableEdges, removedEdgeIds, candidateNodeIds, roots);
  }
  for (const root of state.downstreamNodeIds) {
    collectBranch(root, "downstream", traversableEdges, removedEdgeIds, candidateNodeIds, roots);
  }

  const keptNonOwnershipEdges = traversableEdges.filter((edge) => !removedEdgeIds.has(edge.id));
  const removedNodeIds = new Set(
    [...candidateNodeIds].filter((nodeId) => !keptNonOwnershipEdges.some((edge) => (
      edge.sourceId === nodeId || edge.targetId === nodeId
    )))
  );

  const ownerByColumn = new Map(
    graph.edges
      .filter((edge) => edge.type === "HAS_COLUMN")
      .map((edge) => [edge.targetId, edge.sourceId])
  );
  for (const [columnId, ownerId] of ownerByColumn) {
    if (removedNodeIds.has(ownerId)) removedNodeIds.add(columnId);
  }

  const nodes = graph.nodes.filter((node) => !removedNodeIds.has(node.id));
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => (
    !removedEdgeIds.has(edge.id)
    && visibleNodeIds.has(edge.sourceId)
    && visibleNodeIds.has(edge.targetId)
  ));

  return { ...graph, nodes, edges };
}

function collectBranch(
  rootId: string,
  direction: "upstream" | "downstream",
  edges: LineageGraphRecord["edges"],
  removedEdgeIds: Set<string>,
  candidateNodeIds: Set<string>,
  roots: ReadonlySet<string>
): void {
  const queue = [rootId];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const matches = direction === "upstream"
        ? edge.targetId === current
        : edge.sourceId === current;
      if (!matches) continue;
      removedEdgeIds.add(edge.id);
      const neighbor = direction === "upstream" ? edge.sourceId : edge.targetId;
      if (!roots.has(neighbor)) candidateNodeIds.add(neighbor);
      if (!visited.has(neighbor) && !roots.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
}
