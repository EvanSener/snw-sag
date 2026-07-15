import {
  projectAnswerGraph,
  projectEvidenceGraph
} from "../lineage/answer-projector.js";
import type {
  EvidencePathSummary,
  LineageDirection,
  LineageEvidencePathDetail,
  LineageEvidenceSnapshot,
  LineageGraphRecord,
  LineageView
} from "../lineage/contracts.js";
import {
  invalidLineagePathId,
  lineageGraphNotFound,
  lineagePathNotFound,
  lineageRevisionStale,
  lineageRevisionUnstable
} from "../lineage/errors.js";
import { parseSagPathId } from "../lineage/revision.js";

export interface LineageSnapshotRepository {
  getEvidenceSnapshot(input: {
    tenantId: string;
    projectId: string;
  }): Promise<LineageEvidenceSnapshot | null>;
  getRevision(input: {
    tenantId: string;
    projectId: string;
  }): Promise<string | null>;
}

export interface LineageGraphQuery {
  tenantId: string;
  projectId: string;
  view?: LineageView;
  direction?: LineageDirection;
  nodeId?: string;
  query?: string;
  limit: number;
}

export interface StableLineageAnswerContext {
  graphRevision: string;
  graph: LineageGraphRecord;
}

export class LineageService {
  constructor(private readonly repository: LineageSnapshotRepository) {}

  async getGraph(input: LineageGraphQuery): Promise<LineageGraphRecord> {
    const snapshot = await this.requireSnapshot(input);
    const graph = input.view === "evidence"
      ? projectEvidenceGraph(snapshot)
      : projectAnswerGraph(snapshot).graph;
    return pageGraph(graph, input);
  }

  async getEvidencePath(input: {
    tenantId: string;
    projectId: string;
    pathId: string;
  }): Promise<LineageEvidencePathDetail> {
    let pathRevision: string;
    try {
      pathRevision = parseSagPathId(input.pathId).graphRevision;
    } catch {
      throw invalidLineagePathId();
    }
    const snapshot = await this.requirePathSnapshot(input);
    if (pathRevision !== snapshot.graphRevision) throw lineageRevisionStale();
    const detail = projectAnswerGraph(snapshot).pathsById.get(input.pathId);
    if (!detail) throw lineagePathNotFound();
    return detail;
  }

  async withStableAnswerContext<T>(
    input: LineageGraphQuery,
    work: (context: StableLineageAnswerContext) => Promise<T>
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const snapshot = await this.requireSnapshot(input);
      const graph = pageGraph(projectAnswerGraph(snapshot).graph, {
        ...input,
        view: "answer"
      });
      const result = await work({
        graphRevision: snapshot.graphRevision,
        graph
      });
      const currentRevision = await this.repository.getRevision(input);
      if (currentRevision === snapshot.graphRevision) return result;
    }
    throw lineageRevisionUnstable();
  }

  private async requireSnapshot(input: {
    tenantId: string;
    projectId: string;
  }): Promise<LineageEvidenceSnapshot> {
    const snapshot = await this.repository.getEvidenceSnapshot(input);
    if (!snapshot || !snapshotMatchesScope(snapshot, input)) throw lineageGraphNotFound();
    return snapshot;
  }

  private async requirePathSnapshot(input: {
    tenantId: string;
    projectId: string;
  }): Promise<LineageEvidenceSnapshot> {
    const snapshot = await this.repository.getEvidenceSnapshot(input);
    if (!snapshot || !snapshotMatchesScope(snapshot, input)) throw lineagePathNotFound();
    return snapshot;
  }
}

function pageGraph(graph: LineageGraphRecord, input: LineageGraphQuery): LineageGraphRecord {
  const limit = Math.max(1, input.limit);
  if (input.query?.trim()) {
    const query = input.query.trim().toLowerCase();
    const matching = graph.nodes.filter((node) => node.normalizedName.includes(query));
    return {
      ...graph,
      nodes: matching.slice(0, limit),
      edges: [],
      evidencePathSummaries: [],
      hasMore: matching.length > limit
    };
  }

  if (input.nodeId) {
    const selectedEdges = graph.edges.filter((edge) => {
      if (input.direction === "upstream") return edge.targetId === input.nodeId;
      if (input.direction === "downstream") return edge.sourceId === input.nodeId;
      return edge.sourceId === input.nodeId || edge.targetId === input.nodeId;
    });
    const pagedEdges = selectedEdges.slice(0, limit);
    const nodeIds = new Set([input.nodeId, ...pagedEdges.flatMap((edge) => [edge.sourceId, edge.targetId])]);
    const edgeSummaries = summariesForEdges(graph.evidencePathSummaries, pagedEdges);
    const singleEnded = graph.evidencePathSummaries.filter((summary) => (
      isSingleEndedSummary(summary)
      && summaryMatchesNodeDirection(summary, input.nodeId!, input.direction)
    ));
    const remaining = Math.max(0, limit - pagedEdges.length);
    const pagedSingleEnded = singleEnded.slice(0, remaining);
    const summaries = [...edgeSummaries, ...pagedSingleEnded].sort(compareSummaries);
    return {
      ...graph,
      nodes: graph.nodes.filter((node) => nodeIds.has(node.id)),
      edges: pagedEdges,
      evidencePathSummaries: summaries,
      hasMore: graph.hasMore
        || selectedEdges.length > pagedEdges.length
        || singleEnded.length > pagedSingleEnded.length
    };
  }

  const pagedEdges = graph.edges.slice(0, limit);
  if (graph.edges.length === 0) {
    const singleEnded = graph.evidencePathSummaries.filter(isSingleEndedSummary);
    const pagedSingleEnded = singleEnded.slice(0, limit);
    const nodeIds = new Set(pagedSingleEnded.flatMap(summaryNodeIds));
    const remaining = Math.max(0, limit - pagedSingleEnded.length);
    for (const node of graph.nodes) {
      if (nodeIds.size >= remaining + pagedSingleEnded.length) break;
      nodeIds.add(node.id);
    }
    return {
      ...graph,
      nodes: graph.nodes.filter((node) => nodeIds.has(node.id)),
      evidencePathSummaries: pagedSingleEnded,
      hasMore: graph.hasMore
        || singleEnded.length > pagedSingleEnded.length
        || graph.nodes.some((node) => !nodeIds.has(node.id))
    };
  }
  const nodeIds = new Set(pagedEdges.flatMap((edge) => [edge.sourceId, edge.targetId]));
  const edgeSummaries = summariesForEdges(graph.evidencePathSummaries, pagedEdges);
  const singleEnded = graph.evidencePathSummaries.filter(isSingleEndedSummary);
  const remaining = Math.max(0, limit - pagedEdges.length);
  const pagedSingleEnded = singleEnded.slice(0, remaining);
  for (const summary of pagedSingleEnded) {
    for (const nodeId of summaryNodeIds(summary)) nodeIds.add(nodeId);
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => nodeIds.has(node.id)),
    edges: pagedEdges,
    evidencePathSummaries: [...edgeSummaries, ...pagedSingleEnded].sort(compareSummaries),
    hasMore: graph.hasMore
      || graph.edges.length > pagedEdges.length
      || singleEnded.length > pagedSingleEnded.length
  };
}

function snapshotMatchesScope(
  snapshot: LineageEvidenceSnapshot,
  input: { tenantId: string; projectId: string }
): boolean {
  return snapshot.tenantId === input.tenantId && snapshot.projectId === input.projectId;
}

function summariesForEdges(
  summaries: readonly EvidencePathSummary[],
  edges: readonly LineageGraphRecord["edges"][number][]
): EvidencePathSummary[] {
  const edgeIds = new Set(edges.map((edge) => edge.id));
  return summaries.filter((summary) => (
    summary.sourceNodeId != null
    && summary.targetNodeId != null
    && edgeIds.has(projectedEdgeId(summary))
  ));
}

function projectedEdgeId(summary: EvidencePathSummary): string {
  return `projected:${summary.pathId.split(":").at(-1) ?? ""}`;
}

function isSingleEndedSummary(summary: EvidencePathSummary): boolean {
  return (summary.sourceNodeId == null) !== (summary.targetNodeId == null);
}

function summaryMatchesNodeDirection(
  summary: EvidencePathSummary,
  nodeId: string,
  direction: LineageDirection | undefined
): boolean {
  if (direction === "upstream") {
    return summary.sourceNodeId == null && summary.targetNodeId === nodeId;
  }
  if (direction === "downstream") {
    return summary.sourceNodeId === nodeId && summary.targetNodeId == null;
  }
  return summary.sourceNodeId === nodeId || summary.targetNodeId === nodeId;
}

function summaryNodeIds(summary: EvidencePathSummary): string[] {
  return [summary.sourceNodeId, summary.targetNodeId].filter((nodeId): nodeId is string => nodeId != null);
}

function compareSummaries(left: EvidencePathSummary, right: EvidencePathSummary): number {
  return left.pathId.localeCompare(right.pathId);
}
