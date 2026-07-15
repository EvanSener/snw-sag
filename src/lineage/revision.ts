import { createHash } from "node:crypto";
import type { LineageEvidenceSnapshot } from "./contracts.js";

const revisionPattern = /^sagrev:([0-9a-f]{64})$/;
const pathPattern = /^sagpath:([0-9a-f]{64}):([0-9a-f]{64})$/;

export function computeGraphRevision(snapshot: LineageEvidenceSnapshot): string {
  const canonical = {
    version: "answer-projector.v1",
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    available: snapshot.available,
    nodes: [...snapshot.nodes]
      .sort(compareById)
      .map((node) => ({
        id: node.id,
        sourceId: node.sourceId,
        type: node.type,
        name: node.name,
        normalizedName: node.normalizedName,
        role: node.role,
        roleSource: node.roleSource
      })),
    edges: [...snapshot.edges]
      .sort(compareById)
      .map((edge) => ({
        id: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        type: edge.type,
        contextTaskId: edge.contextTaskId ?? null,
        contextTaskName: edge.contextTaskName ?? null,
        eventIds: [...edge.eventIds].sort(),
        events: [...edge.events].sort(compareById).map((event) => ({
          id: event.id,
          title: event.title,
          summary: event.summary,
          relativePath: event.relativePath,
          statementId: event.statementId
        }))
      }))
  };
  return `sagrev:${sha256(JSON.stringify(canonical))}`;
}

export function createSagPathId(input: {
  graphRevision: string;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  edgeIds: string[];
}): string {
  const revision = revisionPattern.exec(input.graphRevision)?.[1];
  if (!revision) throw new Error("INVALID_LINEAGE_REVISION");
  const digest = sha256(JSON.stringify({
    version: "answer-projector.v1",
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    edgeIds: input.edgeIds
  }));
  return `sagpath:${revision}:${digest}`;
}

export function parseSagPathId(pathId: string): {
  graphRevision: string;
  pathDigest: string;
} {
  const match = pathPattern.exec(pathId);
  if (!match) throw new Error("INVALID_LINEAGE_PATH_ID");
  return {
    graphRevision: `sagrev:${match[1]}`,
    pathDigest: match[2]
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
