import type { LineageGraphRecord, LineageGraphStats } from "../../types.js";

export interface EvidenceCapsuleModel {
  id: string;
  pathId: string;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  label: string;
  hiddenNodeCount: number;
  evidenceCount: number;
}

export interface LineageAnswerViewModel {
  graph: LineageGraphRecord;
  capsules: EvidenceCapsuleModel[];
  metrics: LineageGraphStats;
}

export function buildAnswerViewModel(graph: LineageGraphRecord): LineageAnswerViewModel {
  if (graph.view !== "answer") {
    throw new Error("Lineage workbench requires view=answer");
  }
  return {
    graph,
    capsules: graph.evidencePathSummaries.map((path) => ({
      id: `evidence:${path.pathId}`,
      pathId: path.pathId,
      sourceNodeId: path.sourceNodeId,
      targetNodeId: path.targetNodeId,
      label: `${path.hiddenNodeCount} 个隐藏步骤 · ${path.evidenceCount} 条证据`,
      hiddenNodeCount: path.hiddenNodeCount,
      evidenceCount: path.evidenceCount
    })),
    metrics: { ...graph.stats }
  };
}
