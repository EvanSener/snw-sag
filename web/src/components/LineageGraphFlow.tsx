import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type NodeMouseHandler
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Loader2,
  Maximize2,
  PanelLeftOpen,
  RotateCcw,
  Search
} from "lucide-react";
import {
  collectLineageNeighborhood,
  filterLineageGraph,
  LINEAGE_ENTITY_TYPES,
  LINEAGE_RELATION_KINDS,
  relationKindForEdge,
  type LineageEntityType,
  type LineageRelationKind
} from "../lib/lineage-graph-model.js";
import type { LineageGraphRecord } from "../types.js";
import type { SupportedLanguage } from "../i18n.js";
import { Input } from "./ui/input.js";
import {
  buildLineageCanvasModel,
  relationDisplayLabel,
  type LineageCanvasEdge
} from "./lineage-graph/canvas-model.js";
import {
  LineageCanvasNodeView,
  type LineageFlowNode
} from "./lineage-graph/LineageCanvasNodes.js";
import {
  GraphIconButton,
  LineageExplorerPanel,
  LineageInspectorPanel,
  type LineageInspectorRelation
} from "./lineage-graph/LineageWorkbenchPanels.js";
import { layoutLineageCanvas } from "./lineage-graph/layout.js";
import {
  ENTITY_COLORS,
  RELATION_COLORS,
  text
} from "./lineage-graph/palette.js";
import { loadLineageTraversal } from "./lineage-graph/traversal-loader.js";

const MAX_VISIBLE_NODES = 500;
const MAX_TRAVERSAL_REQUESTS = 40;
const DEFAULT_TRAVERSAL_DEPTH = 1;
const MAX_COLLAPSED_COLUMNS = 6;
const MAX_EXPANDED_COLUMNS = 18;
const NODE_TYPES = { lineage: LineageCanvasNodeView };

const DEFAULT_ENTITY_VISIBILITY: Record<LineageEntityType, boolean> = {
  task: true,
  table: true,
  column: true
};

const DEFAULT_RELATION_VISIBILITY: Record<LineageRelationKind, boolean> = {
  "task-task": true,
  "task-table": true,
  "table-table": true,
  "table-column": true,
  "column-column": true
};

type LineageFlowEdgeData = LineageCanvasEdge & Record<string, unknown>;
type LineageFlowEdge = Edge<LineageFlowEdgeData>;

export function LineageGraphFlow(props: {
  graph: LineageGraphRecord;
  language: SupportedLanguage;
  loadNode: (nodeId: string) => Promise<LineageGraphRecord>;
  search: (query: string) => Promise<LineageGraphRecord>;
  onOpenEvent: (eventId: string) => void;
  onOpenEntity: (entityId: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <LineageGraphWorkbench {...props} />
    </ReactFlowProvider>
  );
}

function LineageGraphWorkbench(props: {
  graph: LineageGraphRecord;
  language: SupportedLanguage;
  loadNode: (nodeId: string) => Promise<LineageGraphRecord>;
  search: (query: string) => Promise<LineageGraphRecord>;
  onOpenEvent: (eventId: string) => void;
  onOpenEntity: (entityId: string) => void;
}) {
  const [visibleGraph, setVisibleGraph] = useState(props.graph);
  const [query, setQuery] = useState("");
  const [loadingNodeIds, setLoadingNodeIds] = useState<Set<string>>(new Set());
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [expandedTableIds, setExpandedTableIds] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [layoutPending, setLayoutPending] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [traversalDepth, setTraversalDepth] = useState(DEFAULT_TRAVERSAL_DEPTH);
  const [entityVisibility, setEntityVisibility] = useState(DEFAULT_ENTITY_VISIBILITY);
  const [relationVisibility, setRelationVisibility] = useState(DEFAULT_RELATION_VISIBILITY);
  const [showRelationLabels, setShowRelationLabels] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const traversalRunRef = useRef(0);
  const layoutRunRef = useRef(0);
  const { fitView } = useReactFlow<LineageFlowNode, LineageFlowEdge>();

  const visibleEntityTypes = useMemo(
    () => new Set(LINEAGE_ENTITY_TYPES.filter((type) => entityVisibility[type])),
    [entityVisibility]
  );
  const visibleRelationKinds = useMemo(
    () => new Set(LINEAGE_RELATION_KINDS.filter((kind) => relationVisibility[kind])),
    [relationVisibility]
  );
  const filteredGraph = useMemo(
    () => filterLineageGraph(visibleGraph, {
      entityTypes: visibleEntityTypes,
      relationKinds: visibleRelationKinds
    }),
    [visibleEntityTypes, visibleGraph, visibleRelationKinds]
  );
  const nodeTypes = useMemo(
    () => new Map(visibleGraph.nodes.map((node) => [node.id, node.type])),
    [visibleGraph.nodes]
  );
  const selectedNeighborhood = useMemo(
    () => selectedNodeId
      ? collectLineageNeighborhood(filteredGraph, selectedNodeId, traversalDepth)
      : null,
    [filteredGraph, selectedNodeId, traversalDepth]
  );
  const visibleCanvasModel = useMemo(
    () => buildLineageCanvasModel(filteredGraph, {
      expandedTableIds,
      maxCollapsedColumns: MAX_COLLAPSED_COLUMNS,
      maxExpandedColumns: MAX_EXPANDED_COLUMNS,
      selectedNodeId,
      neighborhood: selectedNeighborhood,
      showRelationLabels,
      language: props.language
    }),
    [expandedTableIds, filteredGraph, props.language, selectedNeighborhood, selectedNodeId, showRelationLabels]
  );
  const displayedCanvasNodes = useMemo(
    () => selectedNeighborhood
      ? visibleCanvasModel.nodes.filter((node) => node.related)
      : visibleCanvasModel.nodes,
    [selectedNeighborhood, visibleCanvasModel.nodes]
  );
  const displayedCanvasNodeIds = useMemo(
    () => new Set(displayedCanvasNodes.map((node) => node.id)),
    [displayedCanvasNodes]
  );
  const displayedCanvasEdges = useMemo(
    () => visibleCanvasModel.edges.filter((edge) => (
      displayedCanvasNodeIds.has(edge.source) && displayedCanvasNodeIds.has(edge.target)
    )),
    [displayedCanvasNodeIds, visibleCanvasModel.edges]
  );
  const layoutKey = useMemo(
    () => [
      displayedCanvasNodes.map((node) => `${node.id}:${node.width}:${node.height}`).join(","),
      displayedCanvasEdges.map((edge) => `${edge.source}:${edge.target}`).sort().join(",")
    ].join("|"),
    [displayedCanvasEdges, displayedCanvasNodes]
  );
  const selectedNode = selectedNodeId
    ? visibleGraph.nodes.find((node) => node.id === selectedNodeId) ?? null
    : null;

  useEffect(() => {
    traversalRunRef.current += 1;
    const graph = props.graph;
    setVisibleGraph(graph);
    setExpandedNodeIds(new Set());
    setExpandedTableIds(new Set());
    setLoadingNodeIds(new Set());
    setSelectedNodeId(null);
    setTraversalDepth(DEFAULT_TRAVERSAL_DEPTH);
    setMessage(graph.hasMore
      ? text(props.language, "任务骨架已截断，请搜索后展开", "Task skeleton is capped; search to narrow it")
      : "");
  }, [props.graph, props.language]);

  useEffect(() => {
    const runId = layoutRunRef.current + 1;
    layoutRunRef.current = runId;
    setLayoutPending(true);
    void layoutLineageCanvas(displayedCanvasNodes, displayedCanvasEdges).then((result) => {
      if (layoutRunRef.current !== runId) return;
      setPositions(new Map(result.nodes.map((node) => [node.id, node.position])));
      setLayoutPending(false);
      if (result.degraded) {
        setMessage(text(
          props.language,
          "自动布局已降级为稳定分层布局",
          "Automatic layout fell back to the deterministic layered layout"
        ));
      }
      window.requestAnimationFrame(() => {
        void fitView({ padding: 0.16, duration: 420, maxZoom: 1.25 });
      });
    });
  }, [fitView, layoutKey]);

  useEffect(() => {
    if (selectedNodeId && !filteredGraph.nodes.some((node) => node.id === selectedNodeId)) {
      traversalRunRef.current += 1;
      setSelectedNodeId(null);
      setLoadingNodeIds(new Set());
    }
  }, [filteredGraph.nodes, selectedNodeId]);

  const setNodeLoading = useCallback((nodeId: string, loading: boolean) => {
    setLoadingNodeIds((current) => {
      const next = new Set(current);
      if (loading) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  }, []);

  const traverseNode = useCallback(async (nodeId: string, depth: number) => {
    const runId = traversalRunRef.current + 1;
    traversalRunRef.current = runId;
    setLoadingNodeIds(new Set());
    setMessage("");
    try {
      const result = await loadLineageTraversal({
        graph: visibleGraph,
        selectedNodeId: nodeId,
        depth,
        expandedNodeIds,
        maxVisibleNodes: MAX_VISIBLE_NODES,
        maxRequests: MAX_TRAVERSAL_REQUESTS,
        loadNode: props.loadNode,
        shouldContinue: () => traversalRunRef.current === runId,
        onNodeLoading: (loadingNodeId, loading) => {
          if (traversalRunRef.current === runId) setNodeLoading(loadingNodeId, loading);
        },
        onProgress: (graph, expanded) => {
          if (traversalRunRef.current !== runId) return;
          setVisibleGraph(graph);
          setExpandedNodeIds(new Set(expanded));
        }
      });
      if (result.cancelled || traversalRunRef.current !== runId) return;
      setVisibleGraph(result.graph);
      setExpandedNodeIds(result.expandedNodeIds);
      if (result.truncated) {
        setMessage(text(
          props.language,
          "穿透结果达到加载上限，已保留当前关联链路",
          "Traversal reached the loading limit; the current related paths remain available"
        ));
      }
    } catch (error) {
      if (traversalRunRef.current === runId) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }, [expandedNodeIds, props.language, props.loadNode, setNodeLoading, visibleGraph]);

  const selectEntity = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setFiltersOpen(false);
    void traverseNode(nodeId, traversalDepth);
  }, [traversalDepth, traverseNode]);

  const toggleTable = useCallback((tableId: string) => {
    setExpandedTableIds((current) => {
      const next = new Set(current);
      if (next.has(tableId)) next.delete(tableId);
      else next.add(tableId);
      return next;
    });
  }, []);

  const flowNodes = useMemo<LineageFlowNode[]>(
    () => displayedCanvasNodes.map((node, index) => ({
      id: node.id,
      type: "lineage",
      position: positions.get(node.id) ?? { x: 40 + (index % 4) * 320, y: 72 + Math.floor(index / 4) * 140 },
      data: {
        ...node,
        loading: loadingNodeIds.has(node.entityId)
          || node.columns.some((column) => loadingNodeIds.has(column.id)),
        language: props.language,
        onSelectEntity: selectEntity,
        onToggleTable: toggleTable
      },
      style: { width: node.width, height: node.height },
      draggable: true,
      selectable: true
    })),
    [displayedCanvasNodes, loadingNodeIds, positions, props.language, selectEntity, toggleTable]
  );
  const flowEdges = useMemo<LineageFlowEdge[]>(
    () => displayedCanvasEdges.map((edge) => {
      const color = RELATION_COLORS[edge.relationKind];
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: "smoothstep",
        data: { ...edge },
        label: edge.showLabel ? edge.label : undefined,
        labelStyle: { fill: "#334155", fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.96, stroke: "#cbd5e1", strokeWidth: 0.7 },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          stroke: color,
          strokeWidth: Math.min(2.5, 1.15 + Math.log2(edge.evidenceCount + 1) * 0.3),
          opacity: selectedNeighborhood ? 0.95 : 0.72
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 15,
          height: 15
        },
        selectable: true
      };
    }),
    [displayedCanvasEdges, selectedNeighborhood]
  );

  const inspectorRelations = useMemo(
    () => selectedNodeId
      ? buildInspectorRelations(filteredGraph, selectedNodeId, props.language)
      : [],
    [filteredGraph, props.language, selectedNodeId]
  );

  const onNodeClick: NodeMouseHandler<LineageFlowNode> = (event, node) => {
    event.stopPropagation();
    selectEntity(node.data.entityId);
  };
  const onEdgeClick: EdgeMouseHandler<LineageFlowEdge> = (event, edge) => {
    event.stopPropagation();
    const eventId = edge.data?.eventId;
    if (eventId) props.onOpenEvent(eventId);
  };

  function handleTraversalDepthChange(depth: number) {
    const nextDepth = Math.min(5, Math.max(1, depth));
    setTraversalDepth(nextDepth);
    if (selectedNodeId) void traverseNode(selectedNodeId, nextDepth);
  }

  function clearSelection() {
    traversalRunRef.current += 1;
    setSelectedNodeId(null);
    setLoadingNodeIds(new Set());
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized || isSearching) return;
    traversalRunRef.current += 1;
    setIsSearching(true);
    setLoadingNodeIds(new Set());
    setMessage("");
    try {
      const page = await props.search(normalized);
      setVisibleGraph(page);
      setExpandedNodeIds(new Set());
      setExpandedTableIds(new Set());
      setSelectedNodeId(null);
      setTraversalDepth(DEFAULT_TRAVERSAL_DEPTH);
      setMessage(page.nodes.length === 0
        ? text(props.language, "未找到匹配实体", "No matching entities")
        : page.hasMore
          ? text(props.language, "搜索结果已截断", "Search results are capped")
          : "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSearching(false);
    }
  }

  function resetGraph() {
    traversalRunRef.current += 1;
    const graph = props.graph;
    setQuery("");
    setVisibleGraph(graph);
    setExpandedNodeIds(new Set());
    setExpandedTableIds(new Set());
    setLoadingNodeIds(new Set());
    setSelectedNodeId(null);
    setTraversalDepth(DEFAULT_TRAVERSAL_DEPTH);
    setMessage(graph.hasMore
      ? text(props.language, "任务骨架已截断，请搜索后展开", "Task skeleton is capped; search to narrow it")
      : "");
  }

  function resetFilters() {
    setEntityVisibility(DEFAULT_ENTITY_VISIBILITY);
    setRelationVisibility(DEFAULT_RELATION_VISIBILITY);
    setShowRelationLabels(false);
    setTraversalDepth(DEFAULT_TRAVERSAL_DEPTH);
    if (selectedNodeId) void traverseNode(selectedNodeId, DEFAULT_TRAVERSAL_DEPTH);
  }

  function focusSelected() {
    if (!selectedNodeId) return;
    const canvasNodeId = visibleCanvasModel.ownerTableByColumnId.get(selectedNodeId) ?? selectedNodeId;
    void fitView({
      nodes: flowNodes.filter((node) => node.id === canvasNodeId),
      padding: 0.8,
      duration: 420,
      maxZoom: 1.35
    });
  }

  const explorerProps = {
    language: props.language,
    nodeCount: filteredGraph.nodes.length,
    edgeCount: filteredGraph.edges.length,
    entityVisibility,
    relationVisibility,
    showRelationLabels,
    traversalDepth,
    onToggleEntity: (type: LineageEntityType) => setEntityVisibility((current) => ({ ...current, [type]: !current[type] })),
    onToggleRelation: (kind: LineageRelationKind) => setRelationVisibility((current) => ({ ...current, [kind]: !current[kind] })),
    onToggleRelationLabels: () => setShowRelationLabels((value) => !value),
    onTraversalDepthChange: handleTraversalDepthChange,
    onReset: resetFilters
  };
  const inspectorProps = {
    language: props.language,
    node: selectedNode,
    nodeCount: filteredGraph.nodes.length,
    edgeCount: filteredGraph.edges.length,
    loading: loadingNodeIds.size > 0,
    expanded: selectedNode ? expandedNodeIds.has(selectedNode.id) : false,
    highlightedNodeCount: selectedNeighborhood?.nodeIds.size ?? filteredGraph.nodes.length,
    highlightedEdgeCount: selectedNeighborhood?.edgeIds.size ?? filteredGraph.edges.length,
    relations: inspectorRelations,
    onFocus: focusSelected,
    onExpand: () => selectedNodeId && void traverseNode(selectedNodeId, 1),
    onOpen: () => selectedNodeId && props.onOpenEntity(selectedNodeId),
    onOpenEvent: props.onOpenEvent,
    onClose: clearSelection
  };

  return (
    <div
      data-testid="lineage-2d-workbench"
      className="relative flex h-full min-h-[600px] overflow-hidden border border-slate-200 bg-white"
    >
      <LineageExplorerPanel variant="rail" {...explorerProps} />

      <main className="relative min-w-0 flex-1 bg-white" data-testid="lineage-canvas">
        <ReactFlow<LineageFlowNode, LineageFlowEdge>
          className="lineage-flow"
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={(event, node) => {
            event.stopPropagation();
            props.onOpenEntity(node.data.entityId);
          }}
          onEdgeClick={onEdgeClick}
          onPaneClick={clearSelection}
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: 1.25 }}
          minZoom={0.08}
          maxZoom={2.2}
          nodesConnectable={false}
          nodesDraggable
          elementsSelectable
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#dbe2ea" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node) => ENTITY_COLORS[(node.data as unknown as LineageFlowNode["data"]).kind]}
            nodeStrokeColor="#ffffff"
            nodeStrokeWidth={2}
            maskColor="rgba(248, 250, 252, 0.78)"
            className="!hidden !rounded !border !border-slate-200 !bg-white !shadow-sm md:!block"
          />
        </ReactFlow>

        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start gap-2">
          <form className="pointer-events-auto flex min-w-0 flex-1 gap-1.5 md:max-w-2xl" onSubmit={(event) => void handleSearch(event)}>
            <GraphIconButton
              title={text(props.language, "显示筛选", "Show filters")}
              active={filtersOpen}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </GraphIconButton>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-9 rounded border-slate-300 bg-white pl-9 text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:ring-sky-600"
                placeholder={text(props.language, "搜索任务、表或字段", "Search tasks, tables, or columns")}
                aria-label={text(props.language, "搜索血缘实体", "Search lineage entities")}
              />
            </div>
            <GraphIconButton type="submit" disabled={!query.trim() || isSearching} title={text(props.language, "搜索", "Search")}>
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </GraphIconButton>
            <GraphIconButton onClick={resetGraph} title={text(props.language, "恢复任务骨架", "Reset to task skeleton")}>
              <RotateCcw className="h-4 w-4" />
            </GraphIconButton>
            <GraphIconButton onClick={() => void fitView({ padding: 0.16, duration: 420, maxZoom: 1.25 })} title={text(props.language, "适配视图", "Fit view")}>
              <Maximize2 className="h-4 w-4" />
            </GraphIconButton>
          </form>

          <div className="pointer-events-auto hidden h-9 items-center gap-2 rounded border border-slate-200 bg-white px-3 text-[10px] font-medium text-slate-500 shadow-sm 2xl:flex">
            {layoutPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-700" /> : null}
            <span className="tabular-nums">{displayedCanvasNodes.length} {text(props.language, "节点", "nodes")}</span>
            <span className="text-slate-300">/</span>
            <span className="tabular-nums">{displayedCanvasEdges.length} {text(props.language, "关系", "relations")}</span>
          </div>
        </div>

        {filtersOpen ? (
          <LineageExplorerPanel
            variant="overlay"
            {...explorerProps}
            onClose={() => setFiltersOpen(false)}
          />
        ) : null}

        {selectedNode ? <LineageInspectorPanel variant="overlay" {...inspectorProps} /> : null}

        {filteredGraph.nodes.length === 0 ? (
          <div className="absolute inset-0 z-[5] flex items-center justify-center px-6">
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-700 shadow-lg hover:bg-slate-50"
              onClick={resetFilters}
            >
              <RotateCcw className="mr-2 inline h-3.5 w-3.5" />
              {text(props.language, "恢复筛选", "Reset filters")}
            </button>
          </div>
        ) : null}

        {message ? (
          <div className="absolute bottom-3 left-1/2 z-10 max-w-[calc(100%-24px)] -translate-x-1/2 truncate rounded border border-slate-200 bg-white px-3 py-2 text-[10px] text-slate-600 shadow-lg" title={message}>
            {message}
          </div>
        ) : null}
      </main>

      <LineageInspectorPanel variant="rail" {...inspectorProps} />
    </div>
  );
}

function buildInspectorRelations(
  graph: LineageGraphRecord,
  selectedNodeId: string,
  language: SupportedLanguage
): LineageInspectorRelation[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeTypes = new Map(graph.nodes.map((node) => [node.id, node.type]));
  return graph.edges.flatMap((edge) => {
    const incoming = edge.targetId === selectedNodeId;
    const outgoing = edge.sourceId === selectedNodeId;
    if (!incoming && !outgoing) return [];
    const otherId = incoming ? edge.sourceId : edge.targetId;
    const other = nodeById.get(otherId);
    const relationKind = relationKindForEdge(edge, nodeTypes);
    if (!other || !relationKind) return [];
    return [{
      id: edge.id,
      direction: incoming ? "incoming" as const : "outgoing" as const,
      label: relationDisplayLabel(edge.type, language),
      otherName: other.name,
      evidenceCount: edge.evidenceCount,
      eventId: edge.eventId ?? null,
      color: RELATION_COLORS[relationKind]
    }];
  }).sort(compareInspectorRelations).slice(0, 16);
}

function compareInspectorRelations(left: LineageInspectorRelation, right: LineageInspectorRelation): number {
  if (left.direction !== right.direction) return left.direction === "incoming" ? -1 : 1;
  return left.label.localeCompare(right.label) || left.otherName.localeCompare(right.otherName);
}
