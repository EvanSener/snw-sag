import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANSWER_GRAPH_FIXTURE,
  EVIDENCE_PATH_FIXTURE,
  TRAVERSAL_PAGES
} from "../web/src/fixtures/lineage-workbench-fixture.js";
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
