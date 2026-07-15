export const lineageV3Categories = [
  "TASK_PRODUCES_TABLE",
  "TABLE_DATA_FLOW",
  "SQL_TABLE_JOIN",
  "TABLE_TO_COLUMN_LINEAGE",
  "COLUMN_TO_COLUMN_LINEAGE"
] as const;

export type LineageV3Category = typeof lineageV3Categories[number];
export type FixtureLineageRole = "business" | "temporary" | "evidence_only";
export type FixtureEntityType = "task" | "table" | "column";

export interface FixtureLineageEntity {
  type: FixtureEntityType;
  name: string;
  description: string;
  semantics: {
    role: FixtureLineageRole;
  };
}

export interface FixtureLineageRelation {
  source: { type: FixtureEntityType; name: string };
  type: string;
  target: { type: FixtureEntityType; name: string };
  contextTask?: string;
}

export interface FixtureSqlLineageEvidence {
  repositoryId: string;
  fileId: string;
  statementId: string;
  relativePath: string;
  contentHash: string;
  gitCommit: string | null;
  dialect: string;
  parserVersion: string;
  span: {
    startByte: number;
    endByte: number;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

export interface FixtureLineageV3Envelope {
  schema: "snw.sql_lineage_event.v3";
  title: string;
  summary: string;
  content: string;
  category: LineageV3Category;
  keywords: string[];
  evidence: FixtureSqlLineageEvidence;
  entities: FixtureLineageEntity[];
  relations: FixtureLineageRelation[];
}

const relationsByCategory: Record<LineageV3Category, FixtureLineageRelation[]> = {
  TASK_PRODUCES_TABLE: [{
    source: { type: "task", name: "build_order_fact" },
    type: "PRODUCES",
    target: { type: "table", name: "analytics.tmp_customer_snapshot" }
  }],
  TABLE_DATA_FLOW: [{
    source: { type: "table", name: "stage.orders_work" },
    type: "DATA_FLOW",
    target: { type: "table", name: "analytics.tmp_customer_snapshot" },
    contextTask: "build_order_fact"
  }],
  SQL_TABLE_JOIN: [{
    source: { type: "table", name: "raw.orders" },
    type: "LEFT_JOIN",
    target: { type: "table", name: "stage.orders_work" },
    contextTask: "build_order_fact"
  }],
  TABLE_TO_COLUMN_LINEAGE: [{
    source: { type: "table", name: "stage.orders_work" },
    type: "SOURCE_FOR_COLUMN",
    target: { type: "column", name: "analytics.tmp_customer_snapshot.order_id" },
    contextTask: "build_order_fact"
  }],
  COLUMN_TO_COLUMN_LINEAGE: [{
    source: { type: "column", name: "stage.orders_work.order_id" },
    type: "DERIVED_FROM",
    target: { type: "column", name: "analytics.tmp_customer_snapshot.order_id" },
    contextTask: "build_order_fact"
  }]
};

export function validLineageV3Envelope(options: {
  category?: LineageV3Category;
} = {}): FixtureLineageV3Envelope {
  const category = options.category ?? "TABLE_DATA_FLOW";
  return {
    schema: "snw.sql_lineage_event.v3",
    title: `SQL lineage: ${category}`,
    summary: "The statement records deterministic SQL lineage.",
    content: "The build_order_fact statement transforms source data into the target table.",
    category,
    keywords: ["build_order_fact", "raw.orders", "analytics.tmp_customer_snapshot"],
    evidence: {
      repositoryId: "repo:a6dbcb788f1f3c005ea530746b0a5284a47ac58d80708069d513fe9b2a6d7a74",
      fileId: "file:784e08beaddb63bdc7eb4645b606d7905aa433c09c2866bf016de023ac60d8f1",
      statementId: "stmt:ab69c3d8a06de2b730ea02fb99b7f17eefcf94f7eedf615333491296e0cc7344",
      relativePath: "daily/build_order_fact.sql",
      contentHash: "85b0c0ed18ca5c6e04953db3b8b0f48e943379857c686726baa2bfd6a403829c",
      gitCommit: null,
      dialect: "maxcompute",
      parserVersion: "0.1.0",
      span: {
        startByte: 0,
        endByte: 168,
        startLine: 1,
        startColumn: 1,
        endLine: 7,
        endColumn: 2
      }
    },
    entities: [
      {
        type: "task",
        name: "build_order_fact",
        description: "Order fact build task",
        semantics: { role: "business" }
      },
      {
        type: "table",
        name: "raw.orders",
        description: "Persistent source table",
        semantics: { role: "business" }
      },
      {
        type: "table",
        name: "stage.orders_work",
        description: "Intermediate table whose name does not imply its role",
        semantics: { role: "temporary" }
      },
      {
        type: "table",
        name: "analytics.tmp_customer_snapshot",
        description: "Business table whose name contains tmp",
        semantics: { role: "business" }
      },
      {
        type: "column",
        name: "stage.orders_work.order_id",
        description: "Intermediate order identifier",
        semantics: { role: "temporary" }
      },
      {
        type: "column",
        name: "analytics.tmp_customer_snapshot.order_id",
        description: "Business order identifier",
        semantics: { role: "business" }
      },
      {
        type: "column",
        name: "raw.orders.audit_token",
        description: "Evidence-only source context",
        semantics: { role: "evidence_only" }
      }
    ],
    relations: structuredClone(relationsByCategory[category])
  };
}
