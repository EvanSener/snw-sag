import type {
  LineageEvidenceEdge,
  LineageEvidenceEvent,
  LineageEvidenceNode,
  LineageEvidenceSnapshot
} from "../../src/lineage/contracts.js";

export const lineageIds = {
  businessSource: "00000000-0000-0000-0000-000000000101",
  temporary: "00000000-0000-0000-0000-000000000102",
  evidenceOnly: "00000000-0000-0000-0000-000000000103",
  businessTarget: "00000000-0000-0000-0000-000000000104",
  businessBranch: "00000000-0000-0000-0000-000000000105",
  hiddenOnlyA: "00000000-0000-0000-0000-000000000106",
  hiddenOnlyB: "00000000-0000-0000-0000-000000000107",
  hiddenTail: "00000000-0000-0000-0000-000000000108"
} as const;

export function evidenceFixture(): LineageEvidenceSnapshot {
  const nodes: LineageEvidenceNode[] = [
    node(lineageIds.businessSource, "raw.orders", "business"),
    node(lineageIds.temporary, "SECRET_TMP_ORDER_CLEAN", "temporary"),
    node(lineageIds.evidenceOnly, "SECRET_EVIDENCE_CAST", "evidence_only"),
    node(lineageIds.businessTarget, "dwd.order_fact", "business"),
    node(lineageIds.businessBranch, "audit.order_quality", "business"),
    node(lineageIds.hiddenOnlyA, "SECRET_ORPHAN_A", "temporary"),
    node(lineageIds.hiddenOnlyB, "SECRET_ORPHAN_B", "evidence_only"),
    node(lineageIds.hiddenTail, "SECRET_DEAD_END", "temporary")
  ];
  const edges: LineageEvidenceEdge[] = [
    edge("edge-1", lineageIds.businessSource, lineageIds.temporary, "DATA_FLOW"),
    edge("edge-2", lineageIds.temporary, lineageIds.evidenceOnly, "DATA_FLOW"),
    edge("edge-3", lineageIds.evidenceOnly, lineageIds.businessTarget, "DATA_FLOW"),
    edge("edge-4", lineageIds.temporary, lineageIds.businessBranch, "DATA_FLOW"),
    edge("edge-5", lineageIds.businessSource, lineageIds.businessTarget, "LEFT_JOIN"),
    edge("edge-6", lineageIds.hiddenOnlyA, lineageIds.hiddenOnlyB, "DATA_FLOW"),
    edge("edge-7", lineageIds.businessTarget, lineageIds.hiddenTail, "DATA_FLOW")
  ];
  return {
    tenantId: "tenant-a",
    projectId: "project-a",
    available: true,
    graphRevision: `sagrev:${"0".repeat(64)}`,
    nodes,
    edges
  };
}

function node(
  id: string,
  name: string,
  role: LineageEvidenceNode["role"]
): LineageEvidenceNode {
  return {
    id,
    sourceId: "project-a",
    type: "table",
    name,
    normalizedName: name.toLowerCase(),
    relationCount: 1,
    role,
    roleSource: "declared"
  };
}

function edge(id: string, sourceId: string, targetId: string, type: string): LineageEvidenceEdge {
  const event = evidenceEvent(`event-${id}`);
  return {
    id,
    sourceId,
    targetId,
    type,
    contextTaskId: null,
    contextTaskName: null,
    eventId: event.id,
    eventIds: [event.id],
    evidenceCount: 1,
    events: [event]
  };
}

function evidenceEvent(id: string): LineageEvidenceEvent {
  return {
    id,
    title: `Evidence ${id}`,
    summary: "Deterministic SQL lineage evidence.",
    relativePath: `models/${id}.sql`,
    statementId: `stmt:${id.padEnd(64, "0").slice(0, 64)}`
  };
}
