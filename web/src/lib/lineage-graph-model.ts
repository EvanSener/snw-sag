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
    available: current.available || page.available,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    hasMore: current.hasMore || page.hasMore || current.nodes.length + page.nodes.length > maxVisibleNodes
  };
}
