import ELKModule from "elkjs/lib/elk.bundled.js";
import type {
  ELK as ElkInstance,
  ELKConstructorArguments,
  ElkNode
} from "elkjs/lib/elk-api.js";
import type { LineageCanvasEdge, LineageCanvasNode } from "./canvas-model.js";

const ElkConstructor = ELKModule as unknown as new(args?: ELKConstructorArguments) => ElkInstance;
const defaultEngine = new ElkConstructor();

export interface PositionedLineageCanvasNode extends LineageCanvasNode {
  position: { x: number; y: number };
}

export interface LineageLayoutResult {
  nodes: PositionedLineageCanvasNode[];
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
  if (nodes.length === 0) return { nodes: [], degraded: false };
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
    return {
      nodes: nodes.map((node) => ({ ...node, position: positionById.get(node.id)! })),
      degraded: false
    };
  } catch (error) {
    return {
      nodes: fallbackLayout(nodes, edges),
      degraded: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
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
