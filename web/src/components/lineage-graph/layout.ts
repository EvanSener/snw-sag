import ELKModule from "elkjs/lib/elk.bundled.js";
import type {
  ELK as ElkInstance,
  ELKConstructorArguments,
  ElkNode
} from "elkjs/lib/elk-api.js";
import type { LineageCanvasEdge, LineageCanvasNode } from "./canvas-model.js";
import {
  partitionNonCrossingEdges,
  type GeometryPoint
} from "./geometry-audit.js";

const ElkConstructor = ELKModule as unknown as new(args?: ELKConstructorArguments) => ElkInstance;
const defaultEngine = new ElkConstructor();

export interface PositionedLineageCanvasNode extends LineageCanvasNode {
  position: { x: number; y: number };
}

export type LineageLayoutPoint = GeometryPoint;

export interface RoutedLineageCanvasEdge extends LineageCanvasEdge {
  points: LineageLayoutPoint[];
}

export interface LineageLayoutResult {
  nodes: PositionedLineageCanvasNode[];
  edges: RoutedLineageCanvasEdge[];
  bundledEdgeIds: string[];
  degraded: boolean;
  error?: string;
}

export interface LineageLayoutEngine {
  layout: (graph: ElkNode) => Promise<ElkNode>;
}

export async function layoutLineageCanvas(
  nodes: LineageCanvasNode[],
  edges: LineageCanvasEdge[],
  engine: LineageLayoutEngine = defaultEngine
): Promise<LineageLayoutResult> {
  if (nodes.length === 0) return { nodes: [], edges: [], bundledEdgeIds: [], degraded: false };
  try {
    const graph = await engine.layout({
      id: "lineage-root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.padding": "[top=32,left=32,bottom=32,right=32]",
        "elk.spacing.nodeNode": "54",
        "elk.layered.spacing.nodeNodeBetweenLayers": "140",
        "elk.layered.spacing.edgeNodeBetweenLayers": "36",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES"
      },
      children: nodes.map((node) => ({ id: node.id, width: node.width, height: node.height })),
      edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] }))
    });
    const positionById = new Map((graph.children ?? []).map((node) => [node.id, {
      x: node.x ?? 0,
      y: node.y ?? 0
    }]));
    if (positionById.size !== nodes.length) {
      throw new Error("ELK returned an incomplete layout");
    }
    const positionedNodes = nodes.map((node) => ({ ...node, position: positionById.get(node.id)! }));
    const elkEdgeById = new Map((graph.edges ?? []).map((edge) => [edge.id, edge]));
    const routedEdges = edges.map((edge) => ({
      ...edge,
      points: edgePoints(elkEdgeById.get(edge.id)?.sections)
    }));
    const fallbackPointsById = new Map(routeFallbackEdges(edges, positionedNodes).map((edge) => [edge.id, edge.points]));
    for (const edge of routedEdges) {
      if (edge.points.length < 2) edge.points = fallbackPointsById.get(edge.id) ?? [];
    }
    const audited = partitionNonCrossingEdges(routedEdges);
    return {
      nodes: positionedNodes,
      edges: audited.edges,
      bundledEdgeIds: audited.bundledEdgeIds,
      degraded: false
    };
  } catch (error) {
    const positionedNodes = fallbackLayout(nodes, edges);
    const audited = partitionNonCrossingEdges(routeFallbackEdges(edges, positionedNodes));
    return {
      nodes: positionedNodes,
      edges: audited.edges,
      bundledEdgeIds: audited.bundledEdgeIds,
      degraded: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function edgePoints(
  sections: Array<{
    startPoint: LineageLayoutPoint;
    bendPoints?: LineageLayoutPoint[];
    endPoint: LineageLayoutPoint;
  }> | undefined
): LineageLayoutPoint[] {
  const points: LineageLayoutPoint[] = [];
  for (const section of sections ?? []) {
    for (const point of [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]) {
      const previous = points[points.length - 1];
      if (!previous || previous.x !== point.x || previous.y !== point.y) points.push({ x: point.x, y: point.y });
    }
  }
  return points;
}

function routeFallbackEdges(
  edges: LineageCanvasEdge[],
  nodes: PositionedLineageCanvasNode[]
): RoutedLineageCanvasEdge[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return { ...edge, points: [] };
    const start = {
      x: source.position.x + source.width,
      y: source.position.y + source.height / 2
    };
    const end = {
      x: target.position.x,
      y: target.position.y + target.height / 2
    };
    const middleX = start.x <= end.x
      ? (start.x + end.x) / 2
      : Math.max(start.x, end.x + target.width) + 60;
    return {
      ...edge,
      points: deduplicatePoints([
        start,
        { x: middleX, y: start.y },
        { x: middleX, y: end.y },
        end
      ])
    };
  });
}

function deduplicatePoints(points: LineageLayoutPoint[]): LineageLayoutPoint[] {
  return points.filter((point, index) => (
    index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y
  ));
}

function fallbackLayout(
  nodes: LineageCanvasNode[],
  edges: LineageCanvasEdge[]
): PositionedLineageCanvasNode[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  const outgoing = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (edge.source === edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incoming.get(edge.target)?.add(edge.source);
    outgoing.get(edge.source)?.add(edge.target);
  }

  const rank = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => incoming.get(node.id)?.size === 0).map((node) => node.id);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    for (const targetId of outgoing.get(nodeId) ?? []) {
      rank.set(targetId, Math.max(rank.get(targetId) ?? 0, (rank.get(nodeId) ?? 0) + 1));
      const targetIncoming = incoming.get(targetId);
      if (targetIncoming && [...targetIncoming].every((sourceId) => visited.has(sourceId))) queue.push(targetId);
    }
  }
  for (const node of nodes) {
    if (!visited.has(node.id)) rank.set(node.id, Math.max(0, rank.get(node.id) ?? 0));
  }

  const nodesByRank = new Map<number, LineageCanvasNode[]>();
  for (const node of nodes) {
    const nodeRank = rank.get(node.id) ?? 0;
    const layer = nodesByRank.get(nodeRank) ?? [];
    layer.push(node);
    nodesByRank.set(nodeRank, layer);
  }
  const layerWidths = new Map<number, number>();
  for (const [nodeRank, layer] of nodesByRank) {
    layerWidths.set(nodeRank, Math.max(...layer.map((node) => node.width)));
  }
  const layerX = new Map<number, number>();
  let x = 32;
  for (const nodeRank of [...nodesByRank.keys()].sort((left, right) => left - right)) {
    layerX.set(nodeRank, x);
    x += (layerWidths.get(nodeRank) ?? 220) + 140;
  }

  const positioned: PositionedLineageCanvasNode[] = [];
  for (const [nodeRank, layer] of [...nodesByRank.entries()].sort(([left], [right]) => left - right)) {
    let y = 32;
    for (const node of layer) {
      positioned.push({ ...node, position: { x: layerX.get(nodeRank) ?? 32, y } });
      y += node.height + 54;
    }
  }
  return positioned;
}
