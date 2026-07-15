import { describe, expect, it, vi } from "vitest";
import {
  computeGraphRevision,
  createSagPathId,
  parseSagPathId
} from "../src/lineage/revision.js";
import { projectAnswerGraph } from "../src/lineage/answer-projector.js";
import { LineageService } from "../src/services/lineage-service.js";
import { evidenceFixture } from "./fixtures/lineage-evidence-graph.js";

describe("lineage graph revision and path identity", () => {
  it("is stable across row order and changes with answer-relevant content", () => {
    const first = evidenceFixture();
    const reordered = {
      ...first,
      nodes: [...first.nodes].reverse(),
      edges: [...first.edges].reverse()
    };
    expect(computeGraphRevision(first)).toBe(computeGraphRevision(reordered));

    const changed = structuredClone(first);
    changed.nodes[0].name = "raw.orders_renamed";
    expect(computeGraphRevision(changed)).not.toBe(computeGraphRevision(first));
  });

  it("binds a SAG path to one graph revision and ordered evidence chain", () => {
    const graphRevision = computeGraphRevision(evidenceFixture());
    const pathId = createSagPathId({
      graphRevision,
      sourceNodeId: "source",
      targetNodeId: "target",
      edgeIds: ["edge-1", "edge-2"]
    });

    expect(pathId).toMatch(/^sagpath:[0-9a-f]{64}:[0-9a-f]{64}$/);
    expect(parseSagPathId(pathId)).toEqual({
      graphRevision,
      pathDigest: pathId.split(":")[2]
    });
    expect(createSagPathId({
      graphRevision,
      sourceNodeId: "source",
      targetNodeId: "target",
      edgeIds: ["edge-2", "edge-1"]
    })).not.toBe(pathId);
    expect(() => parseSagPathId("sqlpath:external")).toThrow("INVALID_LINEAGE_PATH_ID");
  });

  it("defaults to an answer graph and exposes evidence only when explicit", async () => {
    const snapshot = evidenceFixture();
    snapshot.graphRevision = computeGraphRevision(snapshot);
    const service = new LineageService({
      getEvidenceSnapshot: async () => snapshot,
      getRevision: async () => snapshot.graphRevision
    });

    const answer = await service.getGraph({
      tenantId: "tenant-a",
      projectId: "project-a",
      limit: 100
    });
    const evidence = await service.getGraph({
      tenantId: "tenant-a",
      projectId: "project-a",
      view: "evidence",
      limit: 100
    });

    expect(answer.view).toBe("answer");
    expect(JSON.stringify(answer)).not.toContain("SECRET_TMP_ORDER_CLEAN");
    expect(evidence.view).toBe("evidence");
    expect(JSON.stringify(evidence)).toContain("SECRET_TMP_ORDER_CLEAN");
  });

  it("loads a current evidence path but rejects SQL and stale path identities", async () => {
    const snapshot = evidenceFixture();
    snapshot.graphRevision = computeGraphRevision(snapshot);
    const repository = {
      getEvidenceSnapshot: async () => snapshot,
      getRevision: async () => snapshot.graphRevision
    };
    const service = new LineageService(repository);
    const currentPathId = projectAnswerGraph(snapshot).graph.evidencePathSummaries[0].pathId;

    await expect(service.getEvidencePath({
      tenantId: "tenant-a",
      projectId: "project-a",
      pathId: currentPathId
    })).resolves.toMatchObject({ pathId: currentPathId, graphRevision: snapshot.graphRevision });

    await expect(service.getEvidencePath({
      tenantId: "tenant-a",
      projectId: "project-a",
      pathId: "sqlpath:external"
    })).rejects.toMatchObject({ code: "INVALID_LINEAGE_PATH_ID", statusCode: 400 });

    const stalePathId = currentPathId.replace(snapshot.graphRevision.slice(7), "f".repeat(64));
    await expect(service.getEvidencePath({
      tenantId: "tenant-a",
      projectId: "project-a",
      pathId: stalePathId
    })).rejects.toMatchObject({ code: "LINEAGE_REVISION_STALE", statusCode: 409 });
  });

  it("keeps paged path summaries aligned with the returned edges and nodes", async () => {
    const snapshot = evidenceFixture();
    snapshot.graphRevision = computeGraphRevision(snapshot);
    const service = new LineageService({
      getEvidenceSnapshot: async () => snapshot,
      getRevision: async () => snapshot.graphRevision
    });

    const page = await service.getGraph({
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      nodeId: snapshot.nodes[0].id,
      direction: "downstream",
      limit: 1
    });
    const returnedNodeIds = new Set(page.nodes.map((node) => node.id));
    const returnedEdgeIds = new Set(page.edges.map((edge) => edge.id));

    expect(page.evidencePathSummaries).toHaveLength(1);
    for (const summary of page.evidencePathSummaries) {
      expect(summary.sourceNodeId == null || returnedNodeIds.has(summary.sourceNodeId)).toBe(true);
      expect(summary.targetNodeId == null || returnedNodeIds.has(summary.targetNodeId)).toBe(true);
      if (summary.sourceNodeId && summary.targetNodeId) {
        expect(returnedEdgeIds.has(`projected:${summary.pathId.split(":")[2]}`)).toBe(true);
      }
    }
  });

  it("rejects a repository snapshot outside the requested tenant and project scope", async () => {
    const snapshot = evidenceFixture();
    snapshot.graphRevision = computeGraphRevision(snapshot);
    const service = new LineageService({
      getEvidenceSnapshot: async () => snapshot,
      getRevision: async () => snapshot.graphRevision
    });
    const pathId = projectAnswerGraph(snapshot).graph.evidencePathSummaries[0].pathId;

    await expect(service.getGraph({
      tenantId: "tenant-b",
      projectId: "project-b",
      limit: 10
    })).rejects.toMatchObject({ code: "LINEAGE_GRAPH_NOT_FOUND", statusCode: 404 });
    await expect(service.getEvidencePath({
      tenantId: "tenant-b",
      projectId: "project-b",
      pathId
    })).rejects.toMatchObject({ code: "LINEAGE_PATH_NOT_FOUND", statusCode: 404 });
  });

  it("uses the same path-not-found response for an unavailable project", async () => {
    const service = new LineageService({
      getEvidenceSnapshot: async () => null,
      getRevision: async () => null
    });
    const pathId = createSagPathId({
      graphRevision: `sagrev:${"a".repeat(64)}`,
      sourceNodeId: "source",
      targetNodeId: "target",
      edgeIds: ["edge"]
    });

    await expect(service.getEvidencePath({
      tenantId: "tenant-a",
      projectId: "project-a",
      pathId
    })).rejects.toMatchObject({ code: "LINEAGE_PATH_NOT_FOUND", statusCode: 404 });
  });

  it("retries work once when the graph revision changes", async () => {
    const first = evidenceFixture();
    first.graphRevision = computeGraphRevision(first);
    const second = structuredClone(first);
    second.nodes[0].name = "raw.orders_v2";
    second.graphRevision = computeGraphRevision(second);
    const snapshots = [first, second];
    const revisions = [second.graphRevision, second.graphRevision];
    const work = vi.fn(async (context: { graphRevision: string }) => context.graphRevision);
    const service = new LineageService({
      getEvidenceSnapshot: async () => snapshots.shift() ?? second,
      getRevision: async () => revisions.shift() ?? second.graphRevision
    });

    await expect(service.withStableAnswerContext({
      tenantId: first.tenantId,
      projectId: first.projectId,
      limit: 100
    }, work)).resolves.toBe(second.graphRevision);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the graph revision changes twice", async () => {
    const snapshot = evidenceFixture();
    snapshot.graphRevision = computeGraphRevision(snapshot);
    const service = new LineageService({
      getEvidenceSnapshot: async () => snapshot,
      getRevision: async () => `sagrev:${"f".repeat(64)}`
    });

    await expect(service.withStableAnswerContext({
      tenantId: snapshot.tenantId,
      projectId: snapshot.projectId,
      limit: 100
    }, async () => "unsafe-result")).rejects.toMatchObject({
      code: "LINEAGE_REVISION_UNSTABLE",
      statusCode: 503
    });
  });
});
