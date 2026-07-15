import { describe, expect, it } from "vitest";
import { projectAnswerGraph } from "../src/lineage/answer-projector.js";
import { computeGraphRevision } from "../src/lineage/revision.js";
import type {
  LineageEvidenceEdge,
  LineageEvidenceNode,
  LineageEvidenceSnapshot
} from "../src/lineage/contracts.js";
import { evidenceFixture, lineageIds } from "./fixtures/lineage-evidence-graph.js";

describe("answer-safe lineage projection", () => {
  it("collapses hidden chains without mutating the evidence graph", () => {
    const evidence = evidenceFixture();
    evidence.graphRevision = computeGraphRevision(evidence);
    const before = structuredClone(evidence);

    const projection = projectAnswerGraph(evidence);

    expect(evidence).toEqual(before);
    expect(projection.graph.view).toBe("answer");
    expect(projection.graph.nodes.map((node) => node.id).sort()).toEqual([
      lineageIds.businessBranch,
      lineageIds.businessSource,
      lineageIds.businessTarget
    ].sort());
    expect(projection.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: lineageIds.businessSource, targetId: lineageIds.businessTarget }),
      expect.objectContaining({ sourceId: lineageIds.businessSource, targetId: lineageIds.businessBranch })
    ]));
    expect(projection.graph.evidencePathSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: lineageIds.businessSource,
        targetNodeId: lineageIds.businessTarget,
        hiddenNodeCount: 2,
        evidenceCount: 3
      }),
      expect.objectContaining({
        sourceNodeId: lineageIds.businessSource,
        targetNodeId: lineageIds.businessBranch,
        hiddenNodeCount: 1,
        evidenceCount: 2
      }),
      expect.objectContaining({
        sourceNodeId: lineageIds.businessTarget,
        targetNodeId: null,
        hiddenNodeCount: 1
      })
    ]));
  });

  it("keeps hidden names only in explicit path details", () => {
    const evidence = evidenceFixture();
    evidence.graphRevision = computeGraphRevision(evidence);
    const projection = projectAnswerGraph(evidence);
    const serializedAnswer = JSON.stringify(projection.graph);

    for (const hidden of evidence.nodes.filter((node) => node.role !== "business")) {
      expect(serializedAnswer).not.toContain(hidden.name);
    }
    expect([...projection.pathsById.values()].some((path) => (
      path.nodes.some((node) => node.name === "SECRET_TMP_ORDER_CLEAN")
    ))).toBe(true);
    expect([...projection.pathsById.values()].some((path) => (
      path.nodes.some((node) => node.id === lineageIds.hiddenOnlyA)
    ))).toBe(false);
  });

  it("keeps direct business relations and reports layered statistics", () => {
    const evidence = evidenceFixture();
    evidence.graphRevision = computeGraphRevision(evidence);
    const projection = projectAnswerGraph(evidence);

    expect(projection.graph.edges.some((edge) => edge.id === "edge-5" && edge.type === "LEFT_JOIN")).toBe(true);
    expect(projection.graph.stats).toEqual({
      evidenceLoadedNodes: 8,
      evidenceLoadedEdges: 7,
      answerNodes: 3,
      answerEdges: 3,
      semanticHiddenNodes: 5,
      semanticHiddenEdges: 6
    });
  });

  it("projects a hidden cycle that has only an outgoing business endpoint", () => {
    const businessTarget = testNode("business-target", "dwd.orders", "business");
    const hiddenA = testNode("hidden-a", "SECRET_CYCLE_A", "temporary");
    const hiddenB = testNode("hidden-b", "SECRET_CYCLE_B", "evidence_only");
    const evidence = testSnapshot(
      [businessTarget, hiddenA, hiddenB],
      [
        testEdge("cycle-a-b", hiddenA.id, hiddenB.id),
        testEdge("cycle-b-a", hiddenB.id, hiddenA.id),
        testEdge("cycle-exit", hiddenB.id, businessTarget.id)
      ]
    );

    const projection = projectAnswerGraph(evidence);

    expect(projection.graph.evidencePathSummaries).toEqual([
      expect.objectContaining({
        sourceNodeId: null,
        targetNodeId: businessTarget.id,
        hiddenNodeCount: 2
      })
    ]);
    const [detail] = projection.pathsById.values();
    expect(detail.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      hiddenA.id,
      hiddenB.id,
      businessTarget.id
    ]));
  });

  it("uses one deterministic representative path per endpoint in a dense hidden graph", () => {
    const source = testNode("business-source", "raw.orders", "business");
    const target = testNode("business-target", "dwd.orders", "business");
    const hidden = Array.from({ length: 10 }, (_, index) => (
      testNode(`hidden-${String(index).padStart(2, "0")}`, `SECRET_${index}`, "temporary")
    ));
    const edges: LineageEvidenceEdge[] = [
      testEdge("edge-entry", source.id, hidden[0].id)
    ];
    for (let sourceIndex = 0; sourceIndex < hidden.length; sourceIndex += 1) {
      for (let targetIndex = sourceIndex + 1; targetIndex < hidden.length; targetIndex += 1) {
        edges.push(testEdge(
          `edge-${String(sourceIndex).padStart(2, "0")}-${String(targetIndex).padStart(2, "0")}`,
          hidden[sourceIndex].id,
          hidden[targetIndex].id
        ));
      }
      edges.push(testEdge(
        `edge-exit-${String(sourceIndex).padStart(2, "0")}`,
        hidden[sourceIndex].id,
        target.id
      ));
    }
    const evidence = testSnapshot([source, target, ...hidden], edges);
    const reordered = {
      ...evidence,
      nodes: [...evidence.nodes].reverse(),
      edges: [...evidence.edges].reverse()
    };

    const projection = projectAnswerGraph(evidence);
    const reorderedProjection = projectAnswerGraph(reordered);

    expect(projection.graph.evidencePathSummaries).toHaveLength(1);
    expect(projection.graph.edges).toHaveLength(1);
    expect(projection.graph.evidencePathSummaries[0]).toMatchObject({
      sourceNodeId: source.id,
      targetNodeId: target.id
    });
    expect(reorderedProjection.graph.evidencePathSummaries).toEqual(
      projection.graph.evidencePathSummaries
    );
  });
});

function testSnapshot(
  nodes: LineageEvidenceNode[],
  edges: LineageEvidenceEdge[]
): LineageEvidenceSnapshot {
  const snapshot: LineageEvidenceSnapshot = {
    tenantId: "tenant-a",
    projectId: "project-a",
    available: true,
    graphRevision: `sagrev:${"0".repeat(64)}`,
    nodes,
    edges
  };
  snapshot.graphRevision = computeGraphRevision(snapshot);
  return snapshot;
}

function testNode(
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
    relationCount: 0,
    role,
    roleSource: "declared"
  };
}

function testEdge(id: string, sourceId: string, targetId: string): LineageEvidenceEdge {
  const eventId = `event-${id}`;
  return {
    id,
    sourceId,
    targetId,
    type: "DATA_FLOW",
    contextTaskId: null,
    contextTaskName: null,
    eventId,
    eventIds: [eventId],
    evidenceCount: 1,
    events: [{
      id: eventId,
      title: `Evidence ${id}`,
      summary: "Deterministic evidence.",
      relativePath: `models/${id}.sql`,
      statementId: `stmt:${id.padEnd(64, "0").slice(0, 64)}`
    }]
  };
}
