import { describe, expect, it } from "vitest";
import { ANSWER_GRAPH_FIXTURE } from "../web/src/fixtures/lineage-workbench-fixture.js";
import { collapseLineageGraph } from "../web/src/components/lineage-graph/collapse-model.js";

describe("lineage direction collapse", () => {
  it("collapses a downstream branch while preserving a shared downstream node", () => {
    const collapsed = collapseLineageGraph(ANSWER_GRAPH_FIXTURE, {
      upstreamNodeIds: new Set(),
      downstreamNodeIds: new Set(["table:dwd.order_fact"])
    });

    expect(collapsed.nodes.some((node) => node.id === "table:ads.order_mart")).toBe(true);
    expect(collapsed.edges.some((edge) => (
      edge.sourceId === "table:dwd.payment_fact"
      && edge.targetId === "table:ads.order_mart"
    ))).toBe(true);
    expect(collapsed.edges.some((edge) => (
      edge.sourceId === "table:dwd.order_fact" && edge.type !== "HAS_COLUMN"
    ))).toBe(false);
  });

  it("removes a private downstream chain without mutating the loaded graph", () => {
    const collapsed = collapseLineageGraph(ANSWER_GRAPH_FIXTURE, {
      upstreamNodeIds: new Set(),
      downstreamNodeIds: new Set(["table:raw.orders"])
    });

    expect(collapsed.nodes.some((node) => node.id === "table:dwd.order_fact")).toBe(false);
    expect(collapsed.nodes.some((node) => node.id === "table:raw.orders")).toBe(true);
    expect(ANSWER_GRAPH_FIXTURE.nodes.some((node) => node.id === "table:dwd.order_fact")).toBe(true);
  });

  it("keeps HAS_COLUMN ownership available for a collapsed root", () => {
    const collapsed = collapseLineageGraph(ANSWER_GRAPH_FIXTURE, {
      upstreamNodeIds: new Set(),
      downstreamNodeIds: new Set(["table:raw.orders"])
    });

    expect(collapsed.nodes.some((node) => node.id === "column:raw.orders.order_id")).toBe(true);
    expect(collapsed.edges.some((edge) => (
      edge.type === "HAS_COLUMN" && edge.sourceId === "table:raw.orders"
    ))).toBe(true);
  });
});
