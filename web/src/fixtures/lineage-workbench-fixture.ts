import type {
  LineageEvidencePathDetail,
  LineageGraphEdgeRecord,
  LineageGraphNodeRecord,
  LineageGraphRecord
} from "../types.js";

const PROJECT_ID = "project:lineage-workbench-fixture";
const GRAPH_REVISION = "sagrev:lineage-workbench-fixture-v1";

function node(
  id: string,
  type: LineageGraphNodeRecord["type"],
  name: string,
  relationCount = 1
): LineageGraphNodeRecord {
  return {
    id,
    sourceId: PROJECT_ID,
    type,
    name,
    normalizedName: name.toLowerCase(),
    relationCount
  };
}

function edge(
  id: string,
  sourceId: string,
  targetId: string,
  type: string,
  eventId: string,
  evidenceCount = 1
): LineageGraphEdgeRecord {
  return {
    id,
    sourceId,
    targetId,
    type,
    eventId,
    evidenceCount
  };
}

const ANSWER_NODES: LineageGraphNodeRecord[] = [
  node("table:raw.orders", "table", "raw.orders", 5),
  node("table:dwd.order_fact", "table", "dwd.order_fact", 6),
  node("table:ads.order_mart", "table", "ads.order_mart", 6),
  node("table:dwd.payment_fact", "table", "dwd.payment_fact", 1),
  node("column:raw.orders.order_id", "column", "raw.orders.order_id", 2),
  node("column:raw.orders.amount", "column", "raw.orders.amount", 2),
  node("column:dwd.order_fact.order_id", "column", "dwd.order_fact.order_id", 3),
  node("column:dwd.order_fact.amount", "column", "dwd.order_fact.amount", 3),
  node("column:ads.order_mart.order_id", "column", "ads.order_mart.order_id", 2),
  node("column:ads.order_mart.order_amount", "column", "ads.order_mart.order_amount", 2),
  node("task:cycle-a", "task", "cycle_a", 2),
  node("task:cycle-b", "task", "cycle_b", 2),
  node("task:cycle-c", "task", "cycle_c", 2),
  node("table:k33:left-1", "table", "fixture.k33_left_1", 3),
  node("table:k33:left-2", "table", "fixture.k33_left_2", 3),
  node("table:k33:left-3", "table", "fixture.k33_left_3", 3),
  node("table:k33:right-1", "table", "fixture.k33_right_1", 3),
  node("table:k33:right-2", "table", "fixture.k33_right_2", 3),
  node("table:k33:right-3", "table", "fixture.k33_right_3", 3)
];

const ANSWER_EDGES: LineageGraphEdgeRecord[] = [
  edge(
    "edge:orders-to-fact",
    "table:raw.orders",
    "table:dwd.order_fact",
    "DATA_FLOW",
    "event:orders-to-fact"
  ),
  edge(
    "edge:fact-to-mart:data-flow",
    "table:dwd.order_fact",
    "table:ads.order_mart",
    "DATA_FLOW",
    "event:fact-to-mart"
  ),
  edge(
    "edge:fact-to-mart:join",
    "table:dwd.order_fact",
    "table:ads.order_mart",
    "LEFT_JOIN",
    "event:fact-to-mart-join"
  ),
  edge(
    "edge:payment-to-mart",
    "table:dwd.payment_fact",
    "table:ads.order_mart",
    "DATA_FLOW",
    "event:payment-to-mart"
  ),
  edge(
    "edge:orders-to-mart:projected",
    "table:raw.orders",
    "table:ads.order_mart",
    "DATA_FLOW",
    "event:orders-to-mart-projection",
    3
  ),
  edge(
    "edge:orders-has-order-id",
    "table:raw.orders",
    "column:raw.orders.order_id",
    "HAS_COLUMN",
    "event:orders-field"
  ),
  edge(
    "edge:fact-has-order-id",
    "table:dwd.order_fact",
    "column:dwd.order_fact.order_id",
    "HAS_COLUMN",
    "event:fact-field"
  ),
  edge(
    "edge:orders-has-amount",
    "table:raw.orders",
    "column:raw.orders.amount",
    "HAS_COLUMN",
    "event:orders-amount-field"
  ),
  edge(
    "edge:fact-has-amount",
    "table:dwd.order_fact",
    "column:dwd.order_fact.amount",
    "HAS_COLUMN",
    "event:fact-amount-field"
  ),
  edge(
    "edge:mart-has-order-id",
    "table:ads.order_mart",
    "column:ads.order_mart.order_id",
    "HAS_COLUMN",
    "event:mart-field"
  ),
  edge(
    "edge:mart-has-order-amount",
    "table:ads.order_mart",
    "column:ads.order_mart.order_amount",
    "HAS_COLUMN",
    "event:mart-amount-field"
  ),
  edge(
    "edge:orders-field-to-fact-field",
    "column:raw.orders.order_id",
    "column:dwd.order_fact.order_id",
    "COLUMN_LINEAGE",
    "event:orders-field-lineage"
  ),
  edge(
    "edge:fact-field-to-mart-field",
    "column:dwd.order_fact.order_id",
    "column:ads.order_mart.order_id",
    "COLUMN_LINEAGE",
    "event:mart-field-lineage"
  ),
  edge(
    "edge:orders-amount-to-fact-amount",
    "column:raw.orders.amount",
    "column:dwd.order_fact.amount",
    "COLUMN_LINEAGE",
    "event:orders-amount-lineage"
  ),
  edge(
    "edge:fact-amount-to-mart-amount",
    "column:dwd.order_fact.amount",
    "column:ads.order_mart.order_amount",
    "COLUMN_LINEAGE",
    "event:mart-amount-lineage"
  ),
  edge("edge:cycle:a-b", "task:cycle-a", "task:cycle-b", "DEPENDS_ON", "event:cycle-a-b"),
  edge("edge:cycle:b-c", "task:cycle-b", "task:cycle-c", "DEPENDS_ON", "event:cycle-b-c"),
  edge("edge:cycle:c-a", "task:cycle-c", "task:cycle-a", "DEPENDS_ON", "event:cycle-c-a"),
  ...[1, 2, 3].flatMap((left) => [1, 2, 3].map((right) => edge(
    `edge:k33:${left}-${right}`,
    `table:k33:left-${left}`,
    `table:k33:right-${right}`,
    "DATA_FLOW",
    `event:k33:${left}-${right}`
  )))
];

export const ANSWER_GRAPH_FIXTURE: LineageGraphRecord = {
  available: true,
  view: "answer",
  graphRevision: GRAPH_REVISION,
  nodes: ANSWER_NODES,
  edges: ANSWER_EDGES,
  evidencePathSummaries: [
    {
      pathId: "sagpath:orders-to-mart",
      sourceNodeId: "table:raw.orders",
      targetNodeId: "table:ads.order_mart",
      hiddenNodeCount: 2,
      relationTypes: ["DATA_FLOW", "DATA_FLOW", "DATA_FLOW"],
      evidenceCount: 3,
      eventIds: [
        "event:path:orders-to-mart:001",
        "event:path:orders-to-mart:002",
        "event:path:orders-to-mart:003"
      ]
    }
  ],
  stats: {
    evidenceLoadedNodes: ANSWER_NODES.length + 2,
    evidenceLoadedEdges: ANSWER_EDGES.length + 2,
    answerNodes: ANSWER_NODES.length,
    answerEdges: ANSWER_EDGES.length,
    semanticHiddenNodes: 2,
    semanticHiddenEdges: 3
  },
  hasMore: false
};

export const EVIDENCE_PATH_FIXTURE: LineageEvidencePathDetail = {
  pathId: "sagpath:orders-to-mart",
  graphRevision: GRAPH_REVISION,
  nodes: [
    {
      ...node("table:raw.orders", "table", "raw.orders", 5),
      role: "business",
      order: 0
    },
    {
      ...node("table:stage.order-clean", "table", "stage.tmp_order_clean", 2),
      role: "temporary",
      order: 1
    },
    {
      ...node("table:stage.order-enriched", "table", "stage.order_enriched", 2),
      role: "evidence_only",
      order: 2
    },
    {
      ...node("table:ads.order_mart", "table", "ads.order_mart", 6),
      role: "business",
      order: 3
    }
  ],
  edges: [
    {
      ...edge(
        "edge:evidence:orders-to-clean",
        "table:raw.orders",
        "table:stage.order-clean",
        "DATA_FLOW",
        "event:path:orders-to-mart:001"
      ),
      order: 0,
      eventIds: ["event:path:orders-to-mart:001"]
    },
    {
      ...edge(
        "edge:evidence:clean-to-enriched",
        "table:stage.order-clean",
        "table:stage.order-enriched",
        "DATA_FLOW",
        "event:path:orders-to-mart:002"
      ),
      order: 1,
      eventIds: ["event:path:orders-to-mart:002"]
    },
    {
      ...edge(
        "edge:evidence:enriched-to-mart",
        "table:stage.order-enriched",
        "table:ads.order_mart",
        "DATA_FLOW",
        "event:path:orders-to-mart:003"
      ),
      order: 2,
      eventIds: ["event:path:orders-to-mart:003"]
    }
  ],
  events: [
    {
      id: "event:path:orders-to-mart:001",
      title: "订单源进入清洗步骤",
      summary: "订单源进入第一段证据路径。",
      relativePath: "jobs/build_order_mart.sql",
      statementId: `stmt:${"1".repeat(64)}`
    },
    {
      id: "event:path:orders-to-mart:002",
      title: "清洗结果进入补充步骤",
      summary: "第一段处理结果进入第二段证据路径。",
      relativePath: "jobs/build_order_mart.sql",
      statementId: `stmt:${"2".repeat(64)}`
    },
    {
      id: "event:path:orders-to-mart:003",
      title: "补充结果写入订单集市",
      summary: "证据路径最终到达业务订单集市。",
      relativePath: "jobs/build_order_mart.sql",
      statementId: `stmt:${"3".repeat(64)}`
    }
  ]
};

function traversalPage(
  nodes: LineageGraphNodeRecord[],
  edges: LineageGraphEdgeRecord[],
  hasMore = false
): LineageGraphRecord {
  return {
    available: true,
    view: "answer",
    graphRevision: GRAPH_REVISION,
    nodes,
    edges,
    evidencePathSummaries: [],
    stats: {
      evidenceLoadedNodes: nodes.length,
      evidenceLoadedEdges: edges.length,
      answerNodes: nodes.length,
      answerEdges: edges.length,
      semanticHiddenNodes: 0,
      semanticHiddenEdges: 0
    },
    hasMore
  };
}

export const TRAVERSAL_PAGES: Readonly<Record<string, LineageGraphRecord>> = {
  "table:raw.orders": traversalPage(
    ANSWER_NODES.filter((item) => [
      "table:raw.orders",
      "table:dwd.order_fact"
    ].includes(item.id)),
    ANSWER_EDGES.filter((item) => item.id === "edge:orders-to-fact")
  ),
  "table:dwd.order_fact": traversalPage(
    ANSWER_NODES.filter((item) => [
      "table:raw.orders",
      "table:dwd.order_fact",
      "table:ads.order_mart"
    ].includes(item.id)),
    ANSWER_EDGES.filter((item) => [
      "edge:orders-to-fact",
      "edge:fact-to-mart:data-flow",
      "edge:fact-to-mart:join"
    ].includes(item.id))
  ),
  "table:ads.order_mart": traversalPage(
    ANSWER_NODES.filter((item) => [
      "table:dwd.order_fact",
      "table:dwd.payment_fact",
      "table:ads.order_mart"
    ].includes(item.id)),
    ANSWER_EDGES.filter((item) => [
      "edge:fact-to-mart:data-flow",
      "edge:fact-to-mart:join",
      "edge:payment-to-mart"
    ].includes(item.id))
  )
};
