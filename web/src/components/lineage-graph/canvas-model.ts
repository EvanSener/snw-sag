import {
  relationKindForEdge,
  type LineageNeighborhood,
  type LineageRelationKind
} from "../../lib/lineage-graph-model.js";
import type { LineageGraphRecord } from "../../types.js";

type SupportedLanguage = "zh" | "en";

const TASK_WIDTH = 216;
const TASK_HEIGHT = 64;
const TABLE_WIDTH = 268;
const TABLE_HEADER_HEIGHT = 68;
const COLUMN_ROW_HEIGHT = 30;
const TABLE_FOOTER_HEIGHT = 30;
const STANDALONE_COLUMN_WIDTH = 224;
const STANDALONE_COLUMN_HEIGHT = 58;
const AUTO_LABEL_EDGE_LIMIT = 24;
const JOIN_RELATIONS = new Set([
  "LEFT_JOIN",
  "RIGHT_JOIN",
  "FULL_JOIN",
  "FULL_OUTER_JOIN",
  "INNER_JOIN",
  "CROSS_JOIN"
]);

export interface LineageCanvasColumn {
  id: string;
  name: string;
  fullName: string;
  relationCount: number;
  selected: boolean;
  related: boolean;
}

export interface LineageCanvasNode {
  id: string;
  entityId: string;
  kind: "task" | "table" | "column";
  name: string;
  title: string;
  namespace: string;
  relationCount: number;
  columns: LineageCanvasColumn[];
  totalColumnCount: number;
  hiddenColumnCount: number;
  selected: boolean;
  related: boolean;
  loading: boolean;
  expanded: boolean;
  width: number;
  height: number;
}

export interface LineageCanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  relationType: string;
  relationKind: LineageRelationKind;
  label: string;
  showLabel: boolean;
  eventId: string | null;
  evidenceCount: number;
  originalEdgeIds: string[];
  related: boolean;
}

export interface LineageCanvasModel {
  nodes: LineageCanvasNode[];
  edges: LineageCanvasEdge[];
  ownerTableByColumnId: Map<string, string>;
}

export interface LineageCanvasModelOptions {
  expandedTableIds: ReadonlySet<string>;
  maxCollapsedColumns: number;
  maxExpandedColumns: number;
  selectedNodeId: string | null;
  neighborhood: LineageNeighborhood | null;
  showRelationLabels: boolean;
  language: SupportedLanguage;
}

export function buildLineageCanvasModel(
  graph: LineageGraphRecord,
  options: LineageCanvasModelOptions
): LineageCanvasModel {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeTypes = new Map(graph.nodes.map((node) => [node.id, node.type]));
  const ownerTableByColumnId = collectColumnOwners(graph, nodeById);
  const relevantColumnIds = collectRelevantColumnIds(graph, nodeTypes);
  const columnsByTableId = new Map<string, LineageGraphRecord["nodes"]>();
  for (const node of graph.nodes) {
    if (node.type !== "column") continue;
    const ownerTableId = ownerTableByColumnId.get(node.id);
    if (!ownerTableId) continue;
    const columns = columnsByTableId.get(ownerTableId) ?? [];
    columns.push(node);
    columnsByTableId.set(ownerTableId, columns);
  }

  const nodes = graph.nodes.flatMap<LineageCanvasNode>((node) => {
    if (node.type === "column" && ownerTableByColumnId.has(node.id)) return [];
    if (node.type === "table") {
      const allColumns = columnsByTableId.get(node.id) ?? [];
      const columns = chooseVisibleColumns(node.id, allColumns, relevantColumnIds, options);
      const nameParts = splitQualifiedName(node.name);
      const selected = options.selectedNodeId === node.id
        || allColumns.some((column) => column.id === options.selectedNodeId);
      const related = !options.neighborhood
        || options.neighborhood.nodeIds.has(node.id)
        || allColumns.some((column) => options.neighborhood?.nodeIds.has(column.id));
      const hiddenColumnCount = Math.max(0, allColumns.length - columns.length);
      return [{
        id: node.id,
        entityId: node.id,
        kind: "table",
        name: node.name,
        title: nameParts.title,
        namespace: nameParts.namespace,
        relationCount: node.relationCount,
        columns: columns.map((column) => ({
          id: column.id,
          name: columnDisplayName(column.name, node.name),
          fullName: column.name,
          relationCount: column.relationCount,
          selected: column.id === options.selectedNodeId,
          related: !options.neighborhood || options.neighborhood.nodeIds.has(column.id)
        })),
        totalColumnCount: allColumns.length,
        hiddenColumnCount,
        selected,
        related,
        loading: false,
        expanded: options.expandedTableIds.has(node.id),
        width: TABLE_WIDTH,
        height: tableNodeHeight(columns.length, hiddenColumnCount)
      }];
    }

    const nameParts = splitQualifiedName(node.name);
    return [{
      id: node.id,
      entityId: node.id,
      kind: node.type,
      name: node.name,
      title: nameParts.title,
      namespace: nameParts.namespace,
      relationCount: node.relationCount,
      columns: [],
      totalColumnCount: 0,
      hiddenColumnCount: 0,
      selected: options.selectedNodeId === node.id,
      related: !options.neighborhood || options.neighborhood.nodeIds.has(node.id),
      loading: false,
      expanded: false,
      width: node.type === "task" ? TASK_WIDTH : STANDALONE_COLUMN_WIDTH,
      height: node.type === "task" ? TASK_HEIGHT : STANDALONE_COLUMN_HEIGHT
    }];
  });

  const canvasNodeIds = new Set(nodes.map((node) => node.id));
  const visibleColumnIds = new Set(nodes.flatMap((node) => node.columns.map((column) => column.id)));
  const edgesByKey = new Map<string, LineageCanvasEdge>();
  for (const edge of graph.edges) {
    if (edge.type === "HAS_COLUMN") continue;
    const related = !options.neighborhood || options.neighborhood.edgeIds.has(edge.id);
    if (!related) continue;
    const relationKind = relationKindForEdge(edge, nodeTypes);
    if (!relationKind) continue;
    const source = ownerTableByColumnId.get(edge.sourceId) ?? edge.sourceId;
    const target = ownerTableByColumnId.get(edge.targetId) ?? edge.targetId;
    if (!canvasNodeIds.has(source) || !canvasNodeIds.has(target)) continue;
    const sourceHandle = visibleColumnIds.has(edge.sourceId)
      ? fieldHandle("source", edge.sourceId)
      : "entity-source";
    const targetHandle = visibleColumnIds.has(edge.targetId)
      ? fieldHandle("target", edge.targetId)
      : "entity-target";
    const key = [source, sourceHandle, target, targetHandle, edge.type].join("|");
    const existing = edgesByKey.get(key);
    if (existing) {
      existing.evidenceCount += edge.evidenceCount;
      existing.originalEdgeIds.push(edge.id);
      existing.eventId ??= edge.eventId ?? null;
      continue;
    }
    edgesByKey.set(key, {
      id: edge.id,
      source,
      target,
      sourceHandle,
      targetHandle,
      relationType: edge.type,
      relationKind,
      label: relationDisplayLabel(edge.type, options.language),
      showLabel: JOIN_RELATIONS.has(edge.type)
        || options.showRelationLabels
        || (options.neighborhood !== null && options.neighborhood.edgeIds.size <= AUTO_LABEL_EDGE_LIMIT),
      eventId: edge.eventId ?? null,
      evidenceCount: edge.evidenceCount,
      originalEdgeIds: [edge.id],
      related
    });
  }

  return { nodes, edges: [...edgesByKey.values()], ownerTableByColumnId };
}

export function relationDisplayLabel(type: string, language: SupportedLanguage): string {
  if (JOIN_RELATIONS.has(type)) return type.replaceAll("_", " ");
  const labels: Record<string, [string, string]> = {
    DEPENDS_ON: ["依赖", "Depends on"],
    PRODUCES: ["产出", "Produces"],
    DATA_FLOW: ["数据流", "Data flow"],
    SOURCE_FOR_COLUMN: ["字段来源", "Column source"],
    COLUMN_LINEAGE: ["字段血缘", "Column lineage"]
  };
  const label = labels[type];
  if (label) return language === "en" ? label[1] : label[0];
  return type.replaceAll("_", " ");
}

export function fieldHandle(side: "source" | "target", columnId: string): string {
  return `field-${side}-${columnId}`;
}

function collectColumnOwners(
  graph: LineageGraphRecord,
  nodeById: ReadonlyMap<string, LineageGraphRecord["nodes"][number]>
): Map<string, string> {
  const owners = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.type !== "HAS_COLUMN") continue;
    if (nodeById.get(edge.sourceId)?.type !== "table" || nodeById.get(edge.targetId)?.type !== "column") continue;
    if (!owners.has(edge.targetId)) owners.set(edge.targetId, edge.sourceId);
  }
  return owners;
}

function collectRelevantColumnIds(
  graph: LineageGraphRecord,
  nodeTypes: ReadonlyMap<string, LineageGraphRecord["nodes"][number]["type"]>
): Set<string> {
  const ids = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "HAS_COLUMN") continue;
    if (nodeTypes.get(edge.sourceId) === "column") ids.add(edge.sourceId);
    if (nodeTypes.get(edge.targetId) === "column") ids.add(edge.targetId);
  }
  return ids;
}

function chooseVisibleColumns(
  tableId: string,
  columns: LineageGraphRecord["nodes"],
  relevantColumnIds: ReadonlySet<string>,
  options: LineageCanvasModelOptions
): LineageGraphRecord["nodes"] {
  const expanded = options.expandedTableIds.has(tableId);
  const selected = columns.find((column) => column.id === options.selectedNodeId);
  const candidates = expanded
    ? columns
    : columns.filter((column) => relevantColumnIds.has(column.id) || column.id === options.selectedNodeId);
  const fallback = candidates.length > 0 ? candidates : columns;
  const sorted = [...fallback].sort((left, right) => {
    if (left.id === options.selectedNodeId) return -1;
    if (right.id === options.selectedNodeId) return 1;
    const relevance = Number(relevantColumnIds.has(right.id)) - Number(relevantColumnIds.has(left.id));
    return relevance || left.name.localeCompare(right.name);
  });
  const limit = expanded ? options.maxExpandedColumns : options.maxCollapsedColumns;
  const visible = sorted.slice(0, Math.max(0, limit));
  if (selected && !visible.some((column) => column.id === selected.id)) {
    if (visible.length === 0) visible.push(selected);
    else visible[visible.length - 1] = selected;
  }
  return visible;
}

function splitQualifiedName(name: string): { namespace: string; title: string } {
  const separator = name.lastIndexOf(".");
  if (separator < 0) return { namespace: "", title: name };
  return { namespace: name.slice(0, separator), title: name.slice(separator + 1) };
}

function columnDisplayName(columnName: string, tableName: string): string {
  const prefix = `${tableName}.`;
  if (columnName.startsWith(prefix)) return columnName.slice(prefix.length);
  return splitQualifiedName(columnName).title;
}

function tableNodeHeight(columnCount: number, hiddenColumnCount: number): number {
  return TABLE_HEADER_HEIGHT
    + columnCount * COLUMN_ROW_HEIGHT
    + (hiddenColumnCount > 0 ? TABLE_FOOTER_HEIGHT : 8);
}
