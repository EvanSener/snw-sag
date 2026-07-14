import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import ForceGraph3D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject
} from "react-force-graph-3d";
import {
  Loader2,
  Maximize2,
  RotateCcw,
  Search,
  SlidersHorizontal
} from "lucide-react";
import {
  filterLineageGraph,
  LINEAGE_ENTITY_TYPES,
  LINEAGE_RELATION_KINDS,
  mergeLineageGraphs,
  relationKindForEdge,
  type LineageEntityType,
  type LineageRelationKind
} from "../lib/lineage-graph-model";
import type {
  LineageGraphRecord
} from "../types";
import type { SupportedLanguage } from "../i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  GraphFilterPanel,
  GraphIconButton,
  SelectedNodePanel
} from "./lineage-graph/LineageGraphControls";
import type { GraphLink, GraphNode } from "./lineage-graph/types";
import {
  ENTITY_COLORS,
  RELATION_COLORS,
  createLinkLabelObject,
  createNodeLabelObject,
  linkTooltip,
  nodeTooltip,
  positionLinkLabel,
  text
} from "./lineage-graph/visuals";

const MAX_VISIBLE_NODES = 500;
const DEFAULT_ENTITY_VISIBILITY: Record<LineageEntityType, boolean> = {
  task: true,
  table: true,
  column: true
};
const DEFAULT_LABEL_VISIBILITY: Record<LineageEntityType, boolean> = {
  task: true,
  table: false,
  column: false
};
const DEFAULT_RELATION_VISIBILITY: Record<LineageRelationKind, boolean> = {
  "task-task": true,
  "task-table": true,
  "table-table": true,
  "table-column": true,
  "column-column": true
};

export function LineageGraphFlow(props: {
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [entityVisibility, setEntityVisibility] = useState(DEFAULT_ENTITY_VISIBILITY);
  const [labelVisibility, setLabelVisibility] = useState(DEFAULT_LABEL_VISIBILITY);
  const [relationVisibility, setRelationVisibility] = useState(DEFAULT_RELATION_VISIBILITY);
  const [showRelationLabels, setShowRelationLabels] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(canvasRef);

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
  const graphData = useMemo(() => ({
    nodes: filteredGraph.nodes.map((node) => ({ ...node } as GraphNode)),
    links: filteredGraph.edges.flatMap((edge) => {
      const relationKind = relationKindForEdge(edge, nodeTypes);
      return relationKind === null
        ? []
        : [{
            ...edge,
            source: edge.sourceId,
            target: edge.targetId,
            relationKind
          } satisfies GraphLink];
    })
  }), [filteredGraph.edges, filteredGraph.nodes, nodeTypes]);
  const selectedNode = selectedNodeId
    ? visibleGraph.nodes.find((node) => node.id === selectedNodeId) ?? null
    : null;

  useEffect(() => {
    setVisibleGraph(props.graph);
    setExpandedNodeIds(new Set());
    setLoadingNodeIds(new Set());
    setSelectedNodeId(null);
    setMessage(props.graph.hasMore
      ? text(props.language, "任务骨架已截断，请搜索后展开", "Task skeleton is capped; search to narrow it")
      : "");
  }, [props.graph, props.language]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit(650, 72);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [graphData.nodes.length, size.height, size.width]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.d3Force("charge")?.strength?.(-110);
    graph.d3Force("link")?.distance?.(58);
    graph.d3ReheatSimulation();
  }, [graphData.links.length, graphData.nodes.length]);

  useEffect(() => {
    if (selectedNodeId && !filteredGraph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [filteredGraph.nodes, selectedNodeId]);

  const expandNode = useCallback(async (nodeId: string) => {
    if (loadingNodeIds.has(nodeId) || expandedNodeIds.has(nodeId)) return;
    setLoadingNodeIds((current) => new Set(current).add(nodeId));
    setMessage("");
    try {
      const page = await props.loadNode(nodeId);
      setVisibleGraph((current) => mergeLineageGraphs(current, page, MAX_VISIBLE_NODES));
      setExpandedNodeIds((current) => new Set(current).add(nodeId));
      if (page.hasMore) {
        setMessage(text(props.language, "该节点关系较多，当前只显示前 200 条", "This node has more relations; showing the first 200"));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingNodeIds((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  }, [expandedNodeIds, loadingNodeIds, props]);

  const focusNode = useCallback((node: GraphNode) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const z = node.z ?? 0;
    const distance = Math.hypot(x, y, z);
    const ratio = distance === 0 ? 1 : 1 + 90 / distance;
    const camera = distance === 0
      ? { x: 0, y: 0, z: 90 }
      : { x: x * ratio, y: y * ratio, z: z * ratio };
    graphRef.current?.cameraPosition(camera, { x, y, z }, 700);
  }, []);

  async function handleNodeClick(node: NodeObject<GraphNode>) {
    const graphNode = node as GraphNode;
    setSelectedNodeId(graphNode.id);
    focusNode(graphNode);
    await expandNode(graphNode.id);
  }

  function handleLinkClick(link: LinkObject<GraphNode, GraphLink>) {
    const graphLink = link as GraphLink;
    if (graphLink.eventId) {
      props.onOpenEvent(graphLink.eventId);
    }
  }

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized || isSearching) return;
    setIsSearching(true);
    setMessage("");
    try {
      const page = await props.search(normalized);
      setVisibleGraph(page);
      setExpandedNodeIds(new Set());
      setSelectedNodeId(null);
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
    setQuery("");
    setVisibleGraph(props.graph);
    setExpandedNodeIds(new Set());
    setSelectedNodeId(null);
    setMessage(props.graph.hasMore
      ? text(props.language, "任务骨架已截断，请搜索后展开", "Task skeleton is capped; search to narrow it")
      : "");
  }

  function resetFilters() {
    setEntityVisibility(DEFAULT_ENTITY_VISIBILITY);
    setLabelVisibility(DEFAULT_LABEL_VISIBILITY);
    setRelationVisibility(DEFAULT_RELATION_VISIBILITY);
    setShowRelationLabels(false);
  }

  const nodeThreeObject = useCallback((node: NodeObject<GraphNode>) => {
    const graphNode = node as GraphNode;
    return createNodeLabelObject(graphNode, labelVisibility[graphNode.type]);
  }, [labelVisibility]);

  const linkThreeObject = useCallback((link: LinkObject<GraphNode, GraphLink>) => {
    return createLinkLabelObject(link as GraphLink, props.language, showRelationLabels);
  }, [props.language, showRelationLabels]);

  return (
    <div className="relative h-full min-h-[560px] overflow-hidden border border-slate-200 bg-white">
      <div ref={canvasRef} className="absolute inset-0">
        {size.width > 0 && size.height > 0 ? (
          <ForceGraph3D<GraphNode, GraphLink>
            ref={graphRef}
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor="#ffffff"
            controlType="orbit"
            showNavInfo={false}
            nodeId="id"
            nodeVal={(node) => Math.min(12, 2.8 + Math.log2(Math.max(1, (node as GraphNode).relationCount + 1)) * 1.5)}
            nodeColor={(node) => ENTITY_COLORS[(node as GraphNode).type]}
            nodeLabel={(node) => nodeTooltip(node as GraphNode, props.language)}
            nodeOpacity={0.94}
            nodeResolution={12}
            nodeThreeObject={nodeThreeObject}
            nodeThreeObjectExtend
            linkColor={(link) => RELATION_COLORS[(link as GraphLink).relationKind]}
            linkLabel={(link) => linkTooltip(link as GraphLink, props.language)}
            linkWidth={(link) => Math.min(2.4, 0.65 + Math.log2((link as GraphLink).evidenceCount + 1) * 0.4)}
            linkOpacity={0.62}
            linkDirectionalArrowLength={3.2}
            linkDirectionalArrowRelPos={0.86}
            linkDirectionalArrowColor={(link) => RELATION_COLORS[(link as GraphLink).relationKind]}
            linkCurvature={(link) => (link as GraphLink).type.endsWith("JOIN") ? 0.08 : 0}
            linkThreeObject={linkThreeObject}
            linkThreeObjectExtend
            linkPositionUpdate={positionLinkLabel}
            cooldownTicks={180}
            cooldownTime={4500}
            d3AlphaDecay={0.035}
            d3VelocityDecay={0.28}
            enableNodeDrag
            enableNavigationControls
            onNodeClick={(node) => void handleNodeClick(node)}
            onNodeRightClick={(node, event) => {
              event.preventDefault();
              props.onOpenEntity(String((node as GraphNode).id));
            }}
            onLinkClick={handleLinkClick}
          />
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start gap-2 md:inset-x-3 md:top-3">
        <form className="pointer-events-auto flex min-w-0 flex-1 gap-1.5 md:max-w-xl" onSubmit={(event) => void handleSearch(event)}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 border-slate-300 bg-white/95 pl-9 text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:ring-cyan-600"
              placeholder={text(props.language, "搜索任务、表或字段", "Search tasks, tables, or columns")}
              aria-label={text(props.language, "搜索血缘实体", "Search lineage entities")}
            />
          </div>
          <GraphIconButton
            type="submit"
            disabled={!query.trim() || isSearching}
            title={text(props.language, "搜索", "Search")}
          >
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </GraphIconButton>
          <GraphIconButton type="button" onClick={resetGraph} title={text(props.language, "恢复任务骨架", "Reset to task skeleton")}>
            <RotateCcw className="h-4 w-4" />
          </GraphIconButton>
          <GraphIconButton type="button" onClick={() => graphRef.current?.zoomToFit(650, 72)} title={text(props.language, "适配视图", "Fit view")}>
            <Maximize2 className="h-4 w-4" />
          </GraphIconButton>
          <GraphIconButton type="button" onClick={() => setFiltersOpen((value) => !value)} title={text(props.language, "显示筛选", "Display filters")}>
            <SlidersHorizontal className="h-4 w-4" />
          </GraphIconButton>
        </form>

        <div className="pointer-events-auto hidden h-9 items-center gap-2 border border-slate-200 bg-white/95 px-3 text-xs text-slate-600 shadow-sm lg:flex">
          <span>{filteredGraph.nodes.length}/{visibleGraph.nodes.length} {text(props.language, "实体", "entities")}</span>
          <span className="text-slate-300">/</span>
          <span>{filteredGraph.edges.length}/{visibleGraph.edges.length} {text(props.language, "关系", "relations")}</span>
        </div>
      </div>

      <GraphFilterPanel
        className={filtersOpen ? "block" : "hidden"}
        language={props.language}
        entityVisibility={entityVisibility}
        labelVisibility={labelVisibility}
        relationVisibility={relationVisibility}
        showRelationLabels={showRelationLabels}
        onToggleEntity={(type) => setEntityVisibility((current) => ({ ...current, [type]: !current[type] }))}
        onToggleLabel={(type) => setLabelVisibility((current) => ({ ...current, [type]: !current[type] }))}
        onToggleRelation={(kind) => setRelationVisibility((current) => ({ ...current, [kind]: !current[kind] }))}
        onToggleRelationLabels={() => setShowRelationLabels((value) => !value)}
        onReset={resetFilters}
        onClose={() => setFiltersOpen(false)}
      />

      {selectedNode ? (
        <SelectedNodePanel
          node={selectedNode}
          language={props.language}
          loading={loadingNodeIds.has(selectedNode.id)}
          expanded={expandedNodeIds.has(selectedNode.id)}
          onFocus={() => {
            const runtimeNode = graphData.nodes.find((node) => node.id === selectedNode.id);
            if (runtimeNode) focusNode(runtimeNode);
          }}
          onExpand={() => void expandNode(selectedNode.id)}
          onOpen={() => props.onOpenEntity(selectedNode.id)}
          onClose={() => setSelectedNodeId(null)}
        />
      ) : null}

      {filteredGraph.nodes.length === 0 ? (
        <div className="absolute inset-0 z-[5] flex items-center justify-center px-6">
          <div className="border border-slate-200 bg-white/95 px-4 py-3 text-center text-sm text-slate-700 shadow-lg">
            <div>{text(props.language, "当前筛选隐藏了所有实体", "Current filters hide all entities")}</div>
            <Button className="mt-3" size="sm" variant="outline" onClick={resetFilters}>
              <RotateCcw className="h-4 w-4" />
              {text(props.language, "恢复筛选", "Reset filters")}
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="absolute bottom-3 left-1/2 z-10 max-w-[calc(100%-24px)] -translate-x-1/2 truncate border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-lg" title={message}>
          {message}
        </div>
      ) : null}
    </div>
  );
}

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.floor(entry.contentRect.width));
      const height = Math.max(1, Math.floor(entry.contentRect.height));
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
