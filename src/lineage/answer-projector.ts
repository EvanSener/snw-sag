import type {
  EvidencePathSummary,
  LineageEvidenceEdge,
  LineageEvidencePathDetail,
  LineageEvidenceSnapshot,
  LineageGraphEdgeRecord,
  LineageGraphNodeRecord,
  LineageGraphRecord,
  LineageGraphStats
} from "./contracts.js";
import { createSagPathId } from "./revision.js";

interface CollectedPath {
  sourceNodeId: string | null;
  targetNodeId: string | null;
  nodeIds: string[];
  edgeIds: string[];
}

export interface AnswerProjection {
  graph: LineageGraphRecord;
  pathsById: ReadonlyMap<string, LineageEvidencePathDetail>;
}

export function projectAnswerGraph(snapshot: LineageEvidenceSnapshot): AnswerProjection {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(snapshot.edges.map((edge) => [edge.id, edge]));
  const visibleIds = new Set(snapshot.nodes.filter((node) => node.role === "business").map((node) => node.id));
  const allNodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const paths = collectHiddenPaths(snapshot, visibleIds, nodeById);
  const directEdges = snapshot.edges.filter((edge) => (
    visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId)
  ));
  const pathsById = new Map<string, LineageEvidencePathDetail>();
  const summaries: EvidencePathSummary[] = [];
  const projectedEdges: LineageGraphEdgeRecord[] = [];

  for (const path of paths) {
    const pathEdges = path.edgeIds.map((edgeId) => edgeById.get(edgeId)).filter(isDefined);
    const pathNodes = path.nodeIds.map((nodeId) => nodeById.get(nodeId)).filter(isDefined);
    if (pathEdges.length === 0 || pathNodes.every((node) => node.role === "business")) continue;
    const pathId = createSagPathId({
      graphRevision: snapshot.graphRevision,
      sourceNodeId: path.sourceNodeId,
      targetNodeId: path.targetNodeId,
      edgeIds: path.edgeIds
    });
    const eventIds = unique(pathEdges.flatMap((edge) => edge.eventIds));
    const events = uniqueById(pathEdges.flatMap((edge) => edge.events));
    const hiddenNodeCount = pathNodes.filter((node) => node.role !== "business").length;
    const relationTypes = unique(pathEdges.map((edge) => edge.type));
    summaries.push({
      pathId,
      sourceNodeId: path.sourceNodeId,
      targetNodeId: path.targetNodeId,
      hiddenNodeCount,
      relationTypes,
      evidenceCount: eventIds.length,
      eventIds
    });
    pathsById.set(pathId, {
      pathId,
      graphRevision: snapshot.graphRevision,
      nodes: pathNodes.map((node, order) => ({
        ...publicNode(node),
        role: node.role,
        order
      })),
      edges: pathEdges.map((edge, order) => ({
        ...publicEdge(edge, allNodeIds),
        order,
        eventIds: [...edge.eventIds]
      })),
      events
    });
    if (path.sourceNodeId && path.targetNodeId) {
      projectedEdges.push({
        id: `projected:${pathId.split(":")[2]}`,
        sourceId: path.sourceNodeId,
        targetId: path.targetNodeId,
        type: relationTypes.length === 1 ? relationTypes[0] : "DATA_FLOW",
        contextTaskId: null,
        contextTaskName: null,
        eventId: eventIds[0] ?? null,
        evidenceCount: eventIds.length
      });
    }
  }

  const edges = [
    ...directEdges.map((edge) => publicEdge(edge, visibleIds)),
    ...projectedEdges
  ].sort(compareGraphEdges);
  const relationCounts = countVisibleRelations(edges);
  const nodes = snapshot.nodes
    .filter((node) => visibleIds.has(node.id))
    .map((node) => ({ ...publicNode(node), relationCount: relationCounts.get(node.id) ?? 0 }))
    .sort(compareById);
  const stats = buildStats(snapshot, nodes.length, edges.length);

  return {
    graph: {
      available: snapshot.available,
      view: "answer",
      graphRevision: snapshot.graphRevision,
      nodes,
      edges,
      evidencePathSummaries: summaries.sort(comparePathSummaries),
      stats,
      hasMore: false
    },
    pathsById
  };
}

export function projectEvidenceGraph(snapshot: LineageEvidenceSnapshot): LineageGraphRecord {
  const answer = projectAnswerGraph(snapshot).graph;
  const allIds = new Set(snapshot.nodes.map((node) => node.id));
  return {
    available: snapshot.available,
    view: "evidence",
    graphRevision: snapshot.graphRevision,
    nodes: snapshot.nodes.map(publicNode).sort(compareById),
    edges: snapshot.edges.map((edge) => publicEdge(edge, allIds)).sort(compareGraphEdges),
    evidencePathSummaries: [],
    stats: answer.stats,
    hasMore: false
  };
}

function collectHiddenPaths(
  snapshot: LineageEvidenceSnapshot,
  visibleIds: ReadonlySet<string>,
  nodeById: ReadonlyMap<string, LineageEvidenceSnapshot["nodes"][number]>
): CollectedPath[] {
  const outgoing = new Map<string, LineageEvidenceEdge[]>();
  const incoming = new Map<string, LineageEvidenceEdge[]>();
  for (const edge of [...snapshot.edges].sort(compareById)) {
    const sourceEdges = outgoing.get(edge.sourceId) ?? [];
    sourceEdges.push(edge);
    outgoing.set(edge.sourceId, sourceEdges);
    const targetEdges = incoming.get(edge.targetId) ?? [];
    targetEdges.push(edge);
    incoming.set(edge.targetId, targetEdges);
  }

  const collected: CollectedPath[] = [];
  const reachableFromVisible = new Set<string>();
  const emit = (path: CollectedPath) => {
    if (path.edgeIds.length > 0 && (path.sourceNodeId || path.targetNodeId)) {
      collected.push(path);
    }
  };

  // A node is visited at most once for each business source. This keeps dense
  // graphs polynomial and selects one stable shortest representative per
  // business endpoint instead of enumerating every edge-simple trail.
  for (const sourceNodeId of [...visibleIds].sort()) {
    const queue: Array<{ currentNodeId: string; nodeIds: string[]; edgeIds: string[] }> = [];
    const visitedHidden = new Set<string>();
    const pathsByTarget = new Map<string, CollectedPath>();
    const terminalPaths: CollectedPath[] = [];

    for (const edge of outgoing.get(sourceNodeId) ?? []) {
      if (visibleIds.has(edge.targetId) || !nodeById.has(edge.targetId) || visitedHidden.has(edge.targetId)) {
        continue;
      }
      visitedHidden.add(edge.targetId);
      reachableFromVisible.add(edge.targetId);
      queue.push({
        currentNodeId: edge.targetId,
        nodeIds: [sourceNodeId, edge.targetId],
        edgeIds: [edge.id]
      });
    }

    for (let index = 0; index < queue.length; index += 1) {
      const state = queue[index];
      const candidates = (outgoing.get(state.currentNodeId) ?? []).filter((edge) => (
        nodeById.has(edge.targetId)
      ));
      if (candidates.length === 0) {
        terminalPaths.push({
          sourceNodeId,
          targetNodeId: null,
          nodeIds: state.nodeIds,
          edgeIds: state.edgeIds
        });
        continue;
      }

      for (const edge of candidates) {
        const nextNodeIds = [...state.nodeIds, edge.targetId];
        const nextEdgeIds = [...state.edgeIds, edge.id];
        if (visibleIds.has(edge.targetId)) {
          if (!pathsByTarget.has(edge.targetId)) {
            pathsByTarget.set(edge.targetId, {
              sourceNodeId,
              targetNodeId: edge.targetId,
              nodeIds: nextNodeIds,
              edgeIds: nextEdgeIds
            });
          }
          continue;
        }
        if (visitedHidden.has(edge.targetId)) continue;
        visitedHidden.add(edge.targetId);
        reachableFromVisible.add(edge.targetId);
        queue.push({
          currentNodeId: edge.targetId,
          nodeIds: nextNodeIds,
          edgeIds: nextEdgeIds
        });
      }
    }

    for (const path of [...pathsByTarget.values()].sort(compareCollectedPaths)) emit(path);
    for (const path of terminalPaths.sort(compareCollectedPaths)) emit(path);
    if (pathsByTarget.size === 0 && terminalPaths.length === 0 && queue.length > 0) {
      const fallback = queue[0];
      emit({
        sourceNodeId,
        targetNodeId: null,
        nodeIds: fallback.nodeIds,
        edgeIds: fallback.edgeIds
      });
    }
  }

  // Reverse BFS finds hidden components that have an outgoing business
  // endpoint but no incoming business endpoint. Zero-indegree roots represent
  // ordinary chains; a rootless set is a cycle, so its stable lowest ID is used.
  for (const targetNodeId of [...visibleIds].sort()) {
    const queue: Array<{ currentNodeId: string; nodeIds: string[]; edgeIds: string[] }> = [];
    const pathByHiddenId = new Map<string, { nodeIds: string[]; edgeIds: string[] }>();

    for (const edge of incoming.get(targetNodeId) ?? []) {
      if (visibleIds.has(edge.sourceId) || !nodeById.has(edge.sourceId) || pathByHiddenId.has(edge.sourceId)) {
        continue;
      }
      const path = {
        nodeIds: [edge.sourceId, targetNodeId],
        edgeIds: [edge.id]
      };
      pathByHiddenId.set(edge.sourceId, path);
      queue.push({ currentNodeId: edge.sourceId, ...path });
    }

    for (let index = 0; index < queue.length; index += 1) {
      const state = queue[index];
      for (const edge of incoming.get(state.currentNodeId) ?? []) {
        if (visibleIds.has(edge.sourceId) || !nodeById.has(edge.sourceId) || pathByHiddenId.has(edge.sourceId)) {
          continue;
        }
        const path = {
          nodeIds: [edge.sourceId, ...state.nodeIds],
          edgeIds: [edge.id, ...state.edgeIds]
        };
        pathByHiddenId.set(edge.sourceId, path);
        queue.push({ currentNodeId: edge.sourceId, ...path });
      }
    }

    const sourceLessIds = [...pathByHiddenId.keys()]
      .filter((nodeId) => !reachableFromVisible.has(nodeId))
      .sort();
    const sourceLessSet = new Set(sourceLessIds);
    let roots = sourceLessIds.filter((nodeId) => !(incoming.get(nodeId) ?? []).some((edge) => (
      sourceLessSet.has(edge.sourceId)
    )));
    if (roots.length === 0 && sourceLessIds.length > 0) roots = [sourceLessIds[0]];

    for (const rootId of roots) {
      const path = pathByHiddenId.get(rootId);
      if (!path) continue;
      emit({
        sourceNodeId: null,
        targetNodeId,
        nodeIds: path.nodeIds,
        edgeIds: path.edgeIds
      });
    }
  }

  const uniquePaths = new Map<string, CollectedPath>();
  for (const path of collected) {
    if (!path.sourceNodeId && !path.targetNodeId) continue;
    const key = JSON.stringify([path.sourceNodeId, path.targetNodeId, path.edgeIds]);
    uniquePaths.set(key, path);
  }
  return [...uniquePaths.values()].sort(compareCollectedPaths);
}

function compareCollectedPaths(left: CollectedPath, right: CollectedPath): number {
  return (left.sourceNodeId ?? "").localeCompare(right.sourceNodeId ?? "")
    || (left.targetNodeId ?? "").localeCompare(right.targetNodeId ?? "")
    || left.edgeIds.join("\0").localeCompare(right.edgeIds.join("\0"));
}

function publicNode(node: LineageEvidenceSnapshot["nodes"][number]): LineageGraphNodeRecord {
  return {
    id: node.id,
    sourceId: node.sourceId,
    type: node.type,
    name: node.name,
    normalizedName: node.normalizedName,
    relationCount: node.relationCount
  };
}

function publicEdge(
  edge: LineageEvidenceEdge,
  visibleIds: ReadonlySet<string>
): LineageGraphEdgeRecord {
  const contextIsVisible = !edge.contextTaskId
    || visibleIds.has(edge.contextTaskId);
  return {
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    type: edge.type,
    contextTaskId: contextIsVisible ? edge.contextTaskId ?? null : null,
    contextTaskName: contextIsVisible ? edge.contextTaskName ?? null : null,
    eventId: edge.eventIds[0] ?? edge.eventId ?? null,
    evidenceCount: edge.eventIds.length || edge.evidenceCount
  };
}

function buildStats(
  snapshot: LineageEvidenceSnapshot,
  answerNodes: number,
  answerEdges: number
): LineageGraphStats {
  const hiddenIds = new Set(snapshot.nodes.filter((node) => node.role !== "business").map((node) => node.id));
  return {
    evidenceLoadedNodes: snapshot.nodes.length,
    evidenceLoadedEdges: snapshot.edges.length,
    answerNodes,
    answerEdges,
    semanticHiddenNodes: hiddenIds.size,
    semanticHiddenEdges: snapshot.edges.filter((edge) => (
      hiddenIds.has(edge.sourceId) || hiddenIds.has(edge.targetId)
    )).length
  };
}

function countVisibleRelations(edges: readonly LineageGraphEdgeRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    counts.set(edge.sourceId, (counts.get(edge.sourceId) ?? 0) + 1);
    counts.set(edge.targetId, (counts.get(edge.targetId) ?? 0) + 1);
  }
  return counts;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function comparePathSummaries(left: EvidencePathSummary, right: EvidencePathSummary): number {
  return left.pathId.localeCompare(right.pathId);
}

function compareGraphEdges(left: LineageGraphEdgeRecord, right: LineageGraphEdgeRecord): number {
  return left.sourceId.localeCompare(right.sourceId)
    || left.targetId.localeCompare(right.targetId)
    || left.type.localeCompare(right.type)
    || left.id.localeCompare(right.id);
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
