import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANSWER_GRAPH_FIXTURE,
  EVIDENCE_PATH_FIXTURE,
  TRAVERSAL_PAGES
} from "../web/src/fixtures/lineage-workbench-fixture.js";
import { buildAnswerViewModel } from "../web/src/components/lineage-graph/answer-view-model.js";
import { EvidencePathCache } from "../web/src/components/lineage-graph/evidence-path-cache.js";
import { api } from "../web/src/lib/api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("answer-safe lineage workbench fixture", () => {
  it("keeps the answer graph free of hidden entity names", () => {
    expect(ANSWER_GRAPH_FIXTURE.view).toBe("answer");
    const serialized = JSON.stringify(ANSWER_GRAPH_FIXTURE);
    const sensitiveNodes = EVIDENCE_PATH_FIXTURE.nodes.filter((node) => node.role !== "business");
    for (const node of sensitiveNodes) {
      expect(serialized).not.toContain(node.name);
      expect(serialized).not.toContain(node.id);
    }
  });

  it("exposes only an opaque summary for the first hidden evidence path", () => {
    expect(ANSWER_GRAPH_FIXTURE.evidencePathSummaries[0]).toEqual(expect.objectContaining({
      pathId: "sagpath:orders-to-mart",
      hiddenNodeCount: 2,
      evidenceCount: 3
    }));
  });

  it("keeps hidden entity names in the explicit evidence detail", () => {
    expect(EVIDENCE_PATH_FIXTURE.nodes).toContainEqual(expect.objectContaining({
      name: "stage.tmp_order_clean",
      role: "temporary",
      order: 1
    }));
    expect(EVIDENCE_PATH_FIXTURE.nodes).toContainEqual(expect.objectContaining({
      name: "stage.order_enriched",
      role: "evidence_only",
      order: 2
    }));
  });

  it("covers the business chain, shared downstream, field ports and parallel edges", () => {
    expect(ANSWER_GRAPH_FIXTURE.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: "table:raw.orders",
        targetId: "table:dwd.order_fact",
        type: "DATA_FLOW"
      }),
      expect.objectContaining({
        sourceId: "table:dwd.order_fact",
        targetId: "table:ads.order_mart",
        type: "DATA_FLOW"
      }),
      expect.objectContaining({
        sourceId: "table:dwd.payment_fact",
        targetId: "table:ads.order_mart"
      }),
      expect.objectContaining({
        sourceId: "table:raw.orders",
        targetId: "column:raw.orders.order_id",
        type: "HAS_COLUMN"
      })
    ]));

    const parallelEdges = ANSWER_GRAPH_FIXTURE.edges.filter((edge) => (
      edge.sourceId === "table:dwd.order_fact"
      && edge.targetId === "table:ads.order_mart"
    ));
    expect(parallelEdges).toHaveLength(2);

    const businessFieldPorts = ANSWER_GRAPH_FIXTURE.edges.filter((edge) => (
      edge.type === "HAS_COLUMN"
      && [
        "table:raw.orders",
        "table:dwd.order_fact",
        "table:ads.order_mart"
      ].includes(edge.sourceId)
    ));
    expect(businessFieldPorts).toHaveLength(6);
  });

  it("covers a directed cycle and all nine K3,3 relations", () => {
    expect(ANSWER_GRAPH_FIXTURE.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "task:cycle-a", targetId: "task:cycle-b" }),
      expect.objectContaining({ sourceId: "task:cycle-b", targetId: "task:cycle-c" }),
      expect.objectContaining({ sourceId: "task:cycle-c", targetId: "task:cycle-a" })
    ]));
    expect(ANSWER_GRAPH_FIXTURE.edges.filter((edge) => edge.id.startsWith("edge:k33:"))).toHaveLength(9);
  });

  it("contains deterministic traversal pages for the business chain", () => {
    expect(Object.keys(TRAVERSAL_PAGES)).toEqual([
      "table:raw.orders",
      "table:dwd.order_fact",
      "table:ads.order_mart"
    ]);
  });

  it("creates safe evidence capsules and keeps metric layers separate", () => {
    const model = buildAnswerViewModel(ANSWER_GRAPH_FIXTURE);

    expect(model.capsules).toEqual([
      expect.objectContaining({
        id: "evidence:sagpath:orders-to-mart",
        pathId: "sagpath:orders-to-mart",
        label: "2 个隐藏步骤 · 3 条证据",
        hiddenNodeCount: 2,
        evidenceCount: 3
      })
    ]);
    expect(model.metrics).toEqual(ANSWER_GRAPH_FIXTURE.stats);
    expect(model.metrics).not.toBe(ANSWER_GRAPH_FIXTURE.stats);

    const sensitiveNames = EVIDENCE_PATH_FIXTURE.nodes
      .filter((node) => node.role !== "business")
      .map((node) => node.name);
    for (const name of sensitiveNames) {
      expect(JSON.stringify(model.capsules)).not.toContain(name);
    }
  });

  it("rejects an evidence graph as the answer workbench model", () => {
    expect(() => buildAnswerViewModel({
      ...ANSWER_GRAPH_FIXTURE,
      view: "evidence"
    })).toThrow("Lineage workbench requires view=answer");
  });

  it("isolates evidence path details by project, revision, and path", () => {
    const cache = new EvidencePathCache();
    cache.set("project-a", EVIDENCE_PATH_FIXTURE.graphRevision, EVIDENCE_PATH_FIXTURE);

    expect(cache.get(
      "project-a",
      EVIDENCE_PATH_FIXTURE.graphRevision,
      EVIDENCE_PATH_FIXTURE.pathId
    )).toBe(EVIDENCE_PATH_FIXTURE);
    expect(cache.get("project-a", "sagrev:other", EVIDENCE_PATH_FIXTURE.pathId)).toBeUndefined();
    expect(cache.get(
      "project-b",
      EVIDENCE_PATH_FIXTURE.graphRevision,
      EVIDENCE_PATH_FIXTURE.pathId
    )).toBeUndefined();
    expect(cache.get(
      "project-a",
      EVIDENCE_PATH_FIXTURE.graphRevision,
      "sagpath:other"
    )).toBeUndefined();
  });

  it("clears only the selected project's evidence cache", () => {
    const cache = new EvidencePathCache();
    cache.set("project-a", EVIDENCE_PATH_FIXTURE.graphRevision, EVIDENCE_PATH_FIXTURE);
    cache.set("project-b", EVIDENCE_PATH_FIXTURE.graphRevision, EVIDENCE_PATH_FIXTURE);

    cache.clearProject("project-a");

    expect(cache.get(
      "project-a",
      EVIDENCE_PATH_FIXTURE.graphRevision,
      EVIDENCE_PATH_FIXTURE.pathId
    )).toBeUndefined();
    expect(cache.get(
      "project-b",
      EVIDENCE_PATH_FIXTURE.graphRevision,
      EVIDENCE_PATH_FIXTURE.pathId
    )).toBe(EVIDENCE_PATH_FIXTURE);
  });

  it("rejects evidence detail stored under a different revision", () => {
    const cache = new EvidencePathCache();
    expect(() => cache.set("project-a", "sagrev:other", EVIDENCE_PATH_FIXTURE))
      .toThrow("Evidence path revision does not match the cache key");
  });
});

describe("lineage answer and evidence API", () => {
  it("requests the answer view by default", async () => {
    const fetchMock = stubSuccessfulFetch({ graph: ANSWER_GRAPH_FIXTURE });

    await api.getLineageGraph("project-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/lineage-graph?view=answer",
      expect.any(Object)
    );
  });

  it("requests the evidence view explicitly", async () => {
    const fetchMock = stubSuccessfulFetch({ graph: ANSWER_GRAPH_FIXTURE });

    await api.getLineageGraph("project-1", { view: "evidence" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/lineage-graph?view=evidence",
      expect.any(Object)
    );
  });

  it("passes an AbortSignal to a lineage graph request", async () => {
    const fetchMock = stubSuccessfulFetch({ graph: ANSWER_GRAPH_FIXTURE });
    const controller = new AbortController();

    await api.getLineageGraph("project-1", { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it("encodes an evidence path id and passes its AbortSignal", async () => {
    const fetchMock = stubSuccessfulFetch({ path: EVIDENCE_PATH_FIXTURE });
    const controller = new AbortController();

    await api.getLineageEvidencePath(
      "project-1",
      "sagpath:orders/to mart?revision=1",
      controller.signal
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/lineage-evidence-paths/sagpath%3Aorders%2Fto%20mart%3Frevision%3D1",
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it("preserves AbortError from an evidence path request", async () => {
    const abortError = Object.assign(new Error("request aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(abortError)));

    await expect(api.getLineageEvidencePath(
      "project-1",
      "sagpath:orders-to-mart",
      new AbortController().signal
    )).rejects.toBe(abortError);
  });
});

function stubSuccessfulFetch(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
