import type { LineageEvidencePathDetail } from "../../types.js";

export class EvidencePathCache {
  private readonly projects = new Map<string, Map<string, Map<string, LineageEvidencePathDetail>>>();

  set(projectId: string, graphRevision: string, detail: LineageEvidencePathDetail): void {
    if (detail.graphRevision !== graphRevision) {
      throw new Error("Evidence path revision does not match the cache key");
    }
    const revisions = this.projects.get(projectId) ?? new Map();
    const paths = revisions.get(graphRevision) ?? new Map();
    paths.set(detail.pathId, detail);
    revisions.set(graphRevision, paths);
    this.projects.set(projectId, revisions);
  }

  get(projectId: string, graphRevision: string, pathId: string): LineageEvidencePathDetail | undefined {
    return this.projects.get(projectId)?.get(graphRevision)?.get(pathId);
  }

  clearProject(projectId: string): void {
    this.projects.delete(projectId);
  }
}
