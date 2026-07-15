import type {
  LineageGraphEdgeRecord,
  LineageGraphNodeRecord,
  LineageGraphRecord
} from "../types.js";

export const LINEAGE_ENTITY_TYPES = ["task", "table", "column"] as const;
export const LINEAGE_RELATION_KINDS = [
  "task-task",
  "task-table",
  "table-table",
  "table-column",
  "column-column"
] as const;

export type LineageEntityType = LineageGraphNodeRecord["type"];
export type LineageRelationKind = typeof LINEAGE_RELATION_KINDS[number];

export interface LineageGraphFilters {
  entityTypes: ReadonlySet<LineageEntityType>;
  relationKinds: ReadonlySet<LineageRelationKind>;
}

export interface LineageNeighborhood {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export function collectLineageNeighborhood(
  graph: LineageGraphRecord,
  selectedNodeId: string,
  requestedDepth: number
): LineageNeighborhood {
  if (!graph.nodes.some((node) => node.id === selectedNodeId)) {
    return { nodeIds: new Set(), edgeIds: new Set() };
  }

  const maxDepth = Math.max(1, Math.floor(requestedDepth));
  const adjacency = new Map<string, Array<{ edgeId: string; neighborId: string }>>();
  for (const edge of graph.edges) {
    appendNeighbor(adjacency, edge.sourceId, edge.id, edge.targetId);
    appendNeighbor(adjacency, edge.targetId, edge.id, edge.sourceId);
  }

  const nodeIds = new Set([selectedNodeId]);
  const edgeIds = new Set<string>();
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: selectedNodeId, depth: 0 }];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.depth >= maxDepth) continue;
    for (const adjacent of adjacency.get(current.nodeId) ?? []) {
      edgeIds.add(adjacent.edgeId);
      if (nodeIds.has(adjacent.neighborId)) continue;
      nodeIds.add(adjacent.neighborId);
      queue.push({ nodeId: adjacent.neighborId, depth: current.depth + 1 });
    }
  }
  return { nodeIds, edgeIds };
}

export function relationKindForEdge(
  edge: LineageGraphEdgeRecord,
  nodeTypes: ReadonlyMap<string, LineageEntityType>
): LineageRelationKind | null {
  const sourceType = nodeTypes.get(edge.sourceId);
  const targetType = nodeTypes.get(edge.targetId);
  if (!sourceType || !targetType) {
    return null;
  }
  if (sourceType === targetType) {
    if (sourceType === "task") return "task-task";
    if (sourceType === "table") return "table-table";
    return "column-column";
  }
  if ((sourceType === "task" && targetType === "table") || (sourceType === "table" && targetType === "task")) {
    return "task-table";
  }
  if ((sourceType === "table" && targetType === "column") || (sourceType === "column" && targetType === "table")) {
    return "table-column";
  }
  return null;
}

export function filterLineageGraph(
  graph: LineageGraphRecord,
  filters: LineageGraphFilters
): LineageGraphRecord {
  const nodes = graph.nodes.filter((node) => filters.entityTypes.has(node.type));
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const nodeTypes = new Map(graph.nodes.map((node) => [node.id, node.type]));
  const edges = graph.edges.filter((edge) => {
    if (!visibleNodeIds.has(edge.sourceId) || !visibleNodeIds.has(edge.targetId)) {
      return false;
    }
    const relationKind = relationKindForEdge(edge, nodeTypes);
    return relationKind !== null && filters.relationKinds.has(relationKind);
  });
  return { ...graph, nodes, edges };
}

export function mergeLineageGraphs(
  current: LineageGraphRecord,
  page: LineageGraphRecord,
  maxVisibleNodes: number
): LineageGraphRecord {
  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  for (const node of page.nodes) {
    if (nodes.has(node.id) || nodes.size < maxVisibleNodes) {
      nodes.set(node.id, node);
    }
  }
  const allowed = new Set(nodes.keys());
  const edges = new Map(current.edges.map((edge) => [edge.id, edge]));
  for (const edge of page.edges) {
    if (allowed.has(edge.sourceId) && allowed.has(edge.targetId)) {
      edges.set(edge.id, edge);
    }
  }
  return {
    ...current,
    available: current.available || page.available,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    hasMore: current.hasMore || page.hasMore || current.nodes.length + page.nodes.length > maxVisibleNodes
  };
}

function appendNeighbor(
  adjacency: Map<string, Array<{ edgeId: string; neighborId: string }>>,
  nodeId: string,
  edgeId: string,
  neighborId: string
): void {
  const neighbors = adjacency.get(nodeId) ?? [];
  neighbors.push({ edgeId, neighborId });
  adjacency.set(nodeId, neighbors);
}
