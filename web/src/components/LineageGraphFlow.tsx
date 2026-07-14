import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  useEdgesState,
  useNodesState,
  useReactFlow
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Columns3, Loader2, RotateCcw, Search, Table2, Workflow } from "lucide-react";
import type {
  LineageGraphEdgeRecord,
  LineageGraphNodeRecord,
  LineageGraphRecord
} from "../types";
import type { SupportedLanguage } from "../i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const MAX_VISIBLE_NODES = 500;
const NODE_WIDTH = 260;
const NODE_HEIGHT = 62;
const LANE_GAP = 360;
const ROW_GAP = 92;

type FlowNodeData = {
  label: ReactNode;
  lineageType: LineageGraphNodeRecord["type"];
} & Record<string, unknown>;

type FlowEdgeData = {
  eventId?: string | null;
} & Record<string, unknown>;

type LineageFlowNode = Node<FlowNodeData>;
type LineageFlowEdge = Edge<FlowEdgeData>;

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
      <LineageGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function LineageGraphCanvas(props: {
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
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState("");
  const shouldFocusRef = useRef(true);
  const [nodes, setNodes, onNodesChange] = useNodesState<LineageFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LineageFlowEdge>([]);
  const { fitView } = useReactFlow<LineageFlowNode, LineageFlowEdge>();
  const model = useMemo(() => buildFlowModel(visibleGraph, loadingNodeIds, props.language), [
    loadingNodeIds,
    props.language,
    visibleGraph
  ]);

  useEffect(() => {
    shouldFocusRef.current = true;
    setVisibleGraph(props.graph);
    setExpandedNodeIds(new Set());
    setLoadingNodeIds(new Set());
    setMessage(props.graph.hasMore ? label(props.language, "任务骨架已截断，请搜索后展开", "Task skeleton is capped; search to narrow it") : "");
  }, [props.graph, props.language]);

  useEffect(() => {
    setNodes(model.nodes);
    setEdges(model.edges);
    if (!shouldFocusRef.current || model.nodes.length === 0) {
      return;
    }
    shouldFocusRef.current = false;
    window.requestAnimationFrame(() => {
      void fitView({
        nodes: model.nodes.slice(0, 18),
        padding: 0.16,
        minZoom: 0.45,
        maxZoom: 1.05,
        duration: 180
      });
    });
  }, [fitView, model.edges, model.nodes, setEdges, setNodes]);

  const onNodeClick: NodeMouseHandler<LineageFlowNode> = async (event, node) => {
    event.stopPropagation();
    if (loadingNodeIds.has(node.id) || expandedNodeIds.has(node.id)) {
      return;
    }
    setLoadingNodeIds((current) => new Set(current).add(node.id));
    setMessage("");
    try {
      const page = await props.loadNode(node.id);
      setVisibleGraph((current) => mergeGraphs(current, page));
      setExpandedNodeIds((current) => new Set(current).add(node.id));
      if (page.hasMore) {
        setMessage(label(props.language, "该节点关系较多，当前只显示前 200 条", "This node has more relations; showing the first 200"));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingNodeIds((current) => {
        const next = new Set(current);
        next.delete(node.id);
        return next;
      });
    }
  };

  const onNodeDoubleClick: NodeMouseHandler<LineageFlowNode> = (event, node) => {
    event.stopPropagation();
    props.onOpenEntity(node.id);
  };

  const onEdgeDoubleClick: EdgeMouseHandler<LineageFlowEdge> = (event, edge) => {
    event.stopPropagation();
    if (edge.data?.eventId) {
      props.onOpenEvent(edge.data.eventId);
    }
  };

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized || isSearching) {
      return;
    }
    setIsSearching(true);
    setMessage("");
    try {
      const page = await props.search(normalized);
      shouldFocusRef.current = true;
      setVisibleGraph(page);
      setExpandedNodeIds(new Set());
      setMessage(page.nodes.length === 0
        ? label(props.language, "未找到匹配实体", "No matching entities")
        : page.hasMore
          ? label(props.language, "搜索结果已截断", "Search results are capped")
          : "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSearching(false);
    }
  }

  function reset() {
    shouldFocusRef.current = true;
    setQuery("");
    setVisibleGraph(props.graph);
    setExpandedNodeIds(new Set());
    setMessage(props.graph.hasMore ? label(props.language, "任务骨架已截断，请搜索后展开", "Task skeleton is capped; search to narrow it") : "");
  }

  return (
    <div className="flex h-full min-h-[520px] flex-col overflow-hidden border border-border bg-background">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2 md:flex-row md:items-center">
        <form className="flex min-w-0 flex-1 gap-2" onSubmit={(event) => void handleSearch(event)}>
          <div className="relative min-w-0 flex-1 md:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-9"
              placeholder={label(props.language, "搜索任务、表或字段", "Search tasks, tables, or columns")}
              aria-label={label(props.language, "搜索血缘实体", "Search lineage entities")}
            />
          </div>
          <Button type="submit" size="icon" disabled={!query.trim() || isSearching} title={label(props.language, "搜索", "Search")}>
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={reset} title={label(props.language, "恢复任务骨架", "Reset to task skeleton")}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </form>
        <div className="flex min-h-8 items-center gap-3 text-xs text-muted-foreground">
          <span>{visibleGraph.nodes.length} {label(props.language, "个实体", "entities")}</span>
          <span>{visibleGraph.edges.length} {label(props.language, "条关系", "relations")}</span>
          {message ? <span className="truncate text-foreground" title={message}>{message}</span> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ReactFlow<LineageFlowNode, LineageFlowEdge>
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(event, node) => void onNodeClick(event, node)}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          minZoom={0.15}
          maxZoom={1.8}
          nodesConnectable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="hsl(var(--border))" />
          <Controls showInteractive={false} />
          <MiniMap
            className="hidden sm:block"
            pannable
            zoomable
            nodeColor={(node) => nodeColor(node.data.lineageType)}
            maskColor="rgba(248, 250, 252, 0.72)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

function buildFlowModel(
  graph: LineageGraphRecord,
  loadingNodeIds: Set<string>,
  language: SupportedLanguage
): { nodes: LineageFlowNode[]; edges: LineageFlowEdge[] } {
  const grouped = new Map<LineageGraphNodeRecord["type"], LineageGraphNodeRecord[]>([
    ["task", []],
    ["table", []],
    ["column", []]
  ]);
  for (const node of graph.nodes) {
    grouped.get(node.type)?.push(node);
  }
  for (const items of grouped.values()) {
    items.sort((a, b) => a.name.localeCompare(b.name));
  }

  const types: LineageGraphNodeRecord["type"][] = ["task", "table", "column"];
  const nodes = types.flatMap((type, laneIndex) => (grouped.get(type) ?? []).map((node, rowIndex) => ({
    id: node.id,
    position: { x: laneIndex * LANE_GAP, y: rowIndex * ROW_GAP },
    data: {
      lineageType: node.type,
      label: lineageNodeLabel(node, loadingNodeIds.has(node.id), language)
    },
    style: {
      width: NODE_WIDTH,
      minHeight: NODE_HEIGHT,
      borderRadius: 6,
      border: `1px solid ${nodeBorderColor(node.type)}`,
      background: nodeBackgroundColor(node.type),
      color: "hsl(var(--foreground))",
      padding: 0,
      boxShadow: "none"
    }
  })));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId))
    .map((edge) => lineageEdge(edge));
  return { nodes, edges };
}

function lineageNodeLabel(node: LineageGraphNodeRecord, loading: boolean, language: SupportedLanguage): ReactNode {
  const Icon = node.type === "task" ? Workflow : node.type === "table" ? Table2 : Columns3;
  return (
    <div className="flex min-h-[60px] w-full items-start gap-2 px-3 py-2 text-left">
      {loading ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase text-muted-foreground">{typeLabel(node.type, language)}</div>
        <div className="break-all text-xs font-semibold leading-4" title={node.name}>{node.name}</div>
      </div>
    </div>
  );
}

function lineageEdge(edge: LineageGraphEdgeRecord): LineageFlowEdge {
  const context = edge.contextTaskName ? ` · ${edge.contextTaskName}` : "";
  return {
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    label: `${edge.type}${context}`,
    data: { eventId: edge.eventId },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { stroke: edgeColor(edge.type), strokeWidth: 1.4 },
    labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
    labelBgStyle: { fill: "hsl(var(--background))", fillOpacity: 0.92 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 3
  };
}

function mergeGraphs(current: LineageGraphRecord, page: LineageGraphRecord): LineageGraphRecord {
  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  for (const node of page.nodes) {
    if (nodes.has(node.id) || nodes.size < MAX_VISIBLE_NODES) {
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
    hasMore: current.hasMore || page.hasMore || current.nodes.length + page.nodes.length > MAX_VISIBLE_NODES
  };
}

function typeLabel(type: LineageGraphNodeRecord["type"], language: SupportedLanguage): string {
  if (type === "task") return label(language, "任务", "Task");
  if (type === "table") return label(language, "表", "Table");
  return label(language, "字段", "Column");
}

function nodeBackgroundColor(type: LineageGraphNodeRecord["type"]): string {
  if (type === "task") return "#f8fafc";
  if (type === "table") return "#f0fdf4";
  return "#eff6ff";
}

function nodeBorderColor(type: LineageGraphNodeRecord["type"]): string {
  if (type === "task") return "#94a3b8";
  if (type === "table") return "#86a98f";
  return "#8ca6c8";
}

function nodeColor(type: unknown): string {
  if (type === "task") return "#64748b";
  if (type === "table") return "#4f7f5a";
  return "#5277a3";
}

function edgeColor(type: string): string {
  if (type === "PRODUCES") return "#475569";
  if (type.endsWith("JOIN")) return "#a16207";
  if (type === "DATA_FLOW") return "#15803d";
  if (type === "HAS_COLUMN") return "#64748b";
  return "#2563eb";
}

function label(language: SupportedLanguage, zh: string, en: string): string {
  return language === "zh" ? zh : en;
}
