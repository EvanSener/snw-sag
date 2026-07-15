import { describe, expect, it, vi } from "vitest";
import { extractEventsFromChunk } from "../src/ingestion/extract/extractor.js";
import type { LlmClient } from "../src/ai/llm-client.js";
import {
  lineageV3Categories,
  type FixtureLineageV3Envelope,
  validLineageV3Envelope
} from "./fixtures/lineage-v3-envelope.js";

type V3Mutation = (envelope: FixtureLineageV3Envelope) => void;

const v3InvalidFieldCases: Array<[string, V3Mutation]> = [
  ["evidence unknown field", (value) => {
    (value.evidence as unknown as Record<string, unknown>).absolutePath = "/repo/a.sql";
  }],
  ["evidence absolute relativePath", (value) => {
    value.evidence.relativePath = "/repo/a.sql";
  }],
  ["evidence parent relativePath", (value) => {
    value.evidence.relativePath = "daily/../a.sql";
  }],
  ["evidence backslash relativePath", (value) => {
    value.evidence.relativePath = "daily\\a.sql";
  }],
  ["evidence empty relativePath segment", (value) => {
    value.evidence.relativePath = "daily//a.sql";
  }],
  ["evidence dot relativePath segment", (value) => {
    value.evidence.relativePath = "daily/./a.sql";
  }],
  ["evidence Windows drive relativePath", (value) => {
    value.evidence.relativePath = "C:/repo/a.sql";
  }],
  ["evidence NUL relativePath", (value) => {
    value.evidence.relativePath = "daily/a\0.sql";
  }],
  ["evidence newline relativePath", (value) => {
    value.evidence.relativePath = "daily/a\n.sql";
  }],
  ["evidence whitespace-only relativePath", (value) => {
    value.evidence.relativePath = "   ";
  }],
  ["evidence padded relativePath", (value) => {
    value.evidence.relativePath = " daily/a.sql ";
  }],
  ["evidence uppercase contentHash", (value) => {
    value.evidence.contentHash = "A".repeat(64);
  }],
  ["evidence contentHash with wrong length", (value) => {
    value.evidence.contentHash = "a".repeat(63);
  }],
  ["evidence wrong repositoryId prefix", (value) => {
    value.evidence.repositoryId = `file:${"a".repeat(64)}`;
  }],
  ["evidence repositoryId with wrong hash length", (value) => {
    value.evidence.repositoryId = `repo:${"a".repeat(63)}`;
  }],
  ["evidence repositoryId with uppercase hex", (value) => {
    value.evidence.repositoryId = `repo:${"A".repeat(64)}`;
  }],
  ["evidence wrong fileId prefix", (value) => {
    value.evidence.fileId = `stmt:${"b".repeat(64)}`;
  }],
  ["evidence fileId with wrong hash length", (value) => {
    value.evidence.fileId = `file:${"b".repeat(65)}`;
  }],
  ["evidence fileId with uppercase hex", (value) => {
    value.evidence.fileId = `file:${"B".repeat(64)}`;
  }],
  ["evidence wrong statementId prefix", (value) => {
    value.evidence.statementId = `repo:${"c".repeat(64)}`;
  }],
  ["evidence statementId with wrong hash length", (value) => {
    value.evidence.statementId = `stmt:${"c".repeat(63)}`;
  }],
  ["evidence statementId with uppercase hex", (value) => {
    value.evidence.statementId = `stmt:${"C".repeat(64)}`;
  }],
  ["evidence invalid gitCommit", (value) => {
    value.evidence.gitCommit = "abc";
  }],
  ["evidence gitCommit with uppercase hex", (value) => {
    value.evidence.gitCommit = "A".repeat(40);
  }],
  ["evidence negative startByte", (value) => {
    value.evidence.span.startByte = -1;
  }],
  ["evidence zero-based startLine", (value) => {
    value.evidence.span.startLine = 0;
  }],
  ["evidence zero-based startColumn", (value) => {
    value.evidence.span.startColumn = 0;
  }],
  ["evidence zero-based endLine", (value) => {
    value.evidence.span.endLine = 0;
  }],
  ["evidence zero-based endColumn", (value) => {
    value.evidence.span.endColumn = 0;
  }],
  ["evidence unsafe startByte", (value) => {
    value.evidence.span.startByte = Number.MAX_SAFE_INTEGER + 1;
    value.evidence.span.endByte = Number.MAX_SAFE_INTEGER + 3;
  }],
  ["evidence unsafe endByte", (value) => {
    value.evidence.span.endByte = Number.MAX_SAFE_INTEGER + 1;
  }],
  ["evidence unsafe startLine", (value) => {
    value.evidence.span.startLine = Number.MAX_SAFE_INTEGER + 1;
    value.evidence.span.endLine = Number.MAX_SAFE_INTEGER + 1;
  }],
  ["evidence unsafe startColumn", (value) => {
    value.evidence.span.startColumn = Number.MAX_SAFE_INTEGER + 1;
    value.evidence.span.endColumn = Number.MAX_SAFE_INTEGER + 1;
  }],
  ["evidence unsafe endLine", (value) => {
    value.evidence.span.endLine = Number.MAX_SAFE_INTEGER + 1;
  }],
  ["evidence unsafe endColumn", (value) => {
    value.evidence.span.endColumn = Number.MAX_SAFE_INTEGER + 1;
  }],
  ["evidence endByte equal to startByte", (value) => {
    value.evidence.span.endByte = value.evidence.span.startByte;
  }],
  ["evidence endByte before startByte", (value) => {
    value.evidence.span.startByte = 10;
    value.evidence.span.endByte = 9;
  }],
  ["evidence reversed line span", (value) => {
    value.evidence.span.startLine = 7;
    value.evidence.span.endLine = 6;
  }],
  ["evidence reversed column span", (value) => {
    value.evidence.span.startLine = 7;
    value.evidence.span.endLine = 7;
    value.evidence.span.startColumn = 5;
    value.evidence.span.endColumn = 4;
  }],
  ["evidence empty dialect", (value) => {
    value.evidence.dialect = "   ";
  }],
  ["evidence empty parserVersion", (value) => {
    value.evidence.parserVersion = "";
  }],
  ["evidence span unknown field", (value) => {
    (value.evidence.span as unknown as Record<string, unknown>).contentHash = "d".repeat(64);
  }],
  ["semantics invalid role", (value) => {
    (value.entities[0].semantics as { role: string }).role = "internal";
  }],
  ["semantics unknown field", (value) => {
    (value.entities[0].semantics as unknown as Record<string, unknown>).inferredFromName = true;
  }],
  ["event unknown field", (value) => {
    (value as unknown as Record<string, unknown>).debug = true;
  }],
  ["entity unknown field", (value) => {
    (value.entities[0] as unknown as Record<string, unknown>).metadata = {};
  }],
  ["relation unknown field", (value) => {
    (value.relations[0] as unknown as Record<string, unknown>).confidence = 1;
  }],
  ["relation source reference unknown field", (value) => {
    (value.relations[0].source as unknown as Record<string, unknown>).entityId = "external";
  }],
  ["relation target reference unknown field", (value) => {
    (value.relations[0].target as unknown as Record<string, unknown>).entityId = "external";
  }],
  ["unknown category", (value) => {
    (value as unknown as { category: string }).category = "UNSUPPORTED_LINEAGE";
  }]
];

describe("extractEventsFromChunk", () => {
  it("uses a structured SAG event without calling the LLM", async () => {
    const extractWithLlm = vi.fn(async () => {
      throw new Error("the LLM must not be called for a structured event");
    });
    const llm: LlmClient = {
      extractNamedEntities: vi.fn(async () => []),
      rerankEvents: vi.fn(async () => []),
      extractEventsFromChunk: extractWithLlm
    };
    const envelope = {
      schema: "snw.sql_lineage_event.v1",
      title: "字段加工：result_col 来自 source_a、source_b",
      summary: "result_col 由两个上游字段共同加工得到。",
      content: "任务 lineage_task 的 result_col 来自 source_a、source_b。",
      category: "COLUMN_TO_COLUMN_LINEAGE",
      keywords: ["lineage_task", "result_col", "source_a", "source_b"],
      entities: [
        { type: "task", name: "lineage_task", description: "SQL 血缘任务" },
        { type: "column", name: "target_table.result_col", description: "目标字段" },
        { type: "column", name: "source_table.source_a", description: "上游字段" },
        { type: "column", name: "source_table.source_b", description: "上游字段" }
      ]
    };

    const events = await extractEventsFromChunk({
      llm,
      documentTitle: "lineage_task",
      heading: envelope.title,
      content: envelope.content,
      rawContent: `## ${envelope.title}\n\n${envelope.content}\n\n\`\`\`sag-event\n${JSON.stringify(envelope)}\n\`\`\``,
      references: ["00000000-0000-0000-0000-000000000001"]
    });

    expect(events).toEqual([
      {
        schema: envelope.schema,
        title: envelope.title,
        summary: envelope.summary,
        content: envelope.content,
        category: envelope.category,
        keywords: envelope.keywords,
        entities: envelope.entities,
        references: ["00000000-0000-0000-0000-000000000001"]
      }
    ]);
    expect(extractWithLlm).not.toHaveBeenCalled();
  });

  it("preserves validated v2 typed relations without adding inferred edges", async () => {
    const extractWithLlm = vi.fn(async () => []);
    const llm: LlmClient = {
      extractNamedEntities: vi.fn(async () => []),
      rerankEvents: vi.fn(async () => []),
      extractEventsFromChunk: extractWithLlm
    };
    const envelope = {
      schema: "snw.sql_lineage_event.v2",
      title: "表数据流：db.b 写入 db.c",
      summary: "任务 task_a 从 db.b 写入 db.c。",
      content: "db.b 通过任务 task_a 产出 db.c。",
      category: "TABLE_DATA_FLOW",
      keywords: ["task_a", "db.b", "db.c"],
      entities: [
        { type: "task", name: "task_a", description: "执行写入的任务" },
        { type: "table", name: "db.b", description: "来源表" },
        { type: "table", name: "db.c", description: "目标表" }
      ],
      relations: [
        {
          source: { type: "table", name: "db.b" },
          type: "DATA_FLOW",
          target: { type: "table", name: "db.c" },
          contextTask: "task_a"
        }
      ]
    };

    const [event] = await extractEventsFromChunk({
      llm,
      documentTitle: "task_a",
      heading: envelope.title,
      content: envelope.content,
      rawContent: `\`\`\`sag-event\n${JSON.stringify(envelope)}\n\`\`\``,
      references: []
    });

    expect(event.relations).toEqual(envelope.relations);
    expect(extractWithLlm).not.toHaveBeenCalled();
  });

  it.each(lineageV3Categories)("accepts v3 category %s without calling the LLM", async (category) => {
    const envelope = validLineageV3Envelope({ category });
    const llm = rejectingLlm();

    const events = await extractEventsFromChunk(structuredChunkInput(envelope, llm));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      schema: "snw.sql_lineage_event.v3",
      category,
      evidence: envelope.evidence,
      entities: expect.arrayContaining([
        expect.objectContaining({ semantics: { role: "business" } }),
        expect.objectContaining({ semantics: { role: "temporary" } }),
        expect.objectContaining({ semantics: { role: "evidence_only" } })
      ]),
      relations: envelope.relations
    });
    expect(llm.extractEventsFromChunk).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "e".repeat(40),
    "f".repeat(64)
  ])("accepts v3 evidence gitCommit %s", async (gitCommit) => {
    const envelope = validLineageV3Envelope();
    envelope.evidence.gitCommit = gitCommit;

    const [event] = await extractEventsFromChunk(structuredChunkInput(envelope, rejectingLlm()));

    expect(event.evidence?.gitCommit).toBe(gitCommit);
  });

  it("keeps v2 output free of inferred semantics and evidence", async () => {
    const envelope = validV2Envelope();
    const llm = rejectingLlm();

    const [event] = await extractEventsFromChunk(structuredChunkInput(envelope, llm));

    expect(event.schema).toBe("snw.sql_lineage_event.v2");
    expect(event.evidence).toBeUndefined();
    expect(event.entities.every((entity) => entity.semantics === undefined)).toBe(true);
    expect(llm.extractEventsFromChunk).not.toHaveBeenCalled();
  });

  it("preserves explicit v3 semantics without guessing roles from tmp or temp names", async () => {
    const envelope = validLineageV3Envelope();

    const [event] = await extractEventsFromChunk(structuredChunkInput(envelope, rejectingLlm()));

    expect(event.entities.find((entity) => entity.name === "analytics.tmp_customer_snapshot")?.semantics)
      .toEqual({ role: "business" });
    expect(event.entities.find((entity) => entity.name === "stage.orders_work")?.semantics)
      .toEqual({ role: "temporary" });
  });

  it.each(v3InvalidFieldCases)("rejects v3 %s", async (_name, mutate) => {
    const envelope = validLineageV3Envelope();
    const llm = rejectingLlm();
    mutate(envelope);

    await expect(extractEventsFromChunk(structuredChunkInput(envelope, llm)))
      .rejects.toThrow("Invalid structured SAG event");
    expect(llm.extractEventsFromChunk).not.toHaveBeenCalled();
  });

  it("rejects an unknown structured SAG event schema without calling the LLM", async () => {
    const envelope = validLineageV3Envelope();
    const llm = rejectingLlm();
    (envelope as unknown as { schema: string }).schema = "snw.sql_lineage_event.v999";

    await expect(extractEventsFromChunk(structuredChunkInput(envelope, llm)))
      .rejects.toThrow("Invalid structured SAG event");
    expect(llm.extractEventsFromChunk).not.toHaveBeenCalled();
  });

  it("rejects v3 relation source endpoints outside the event entity closure", async () => {
    const envelope = validLineageV3Envelope();
    envelope.relations[0].source.name = "warehouse.missing_source";

    await expect(extractEventsFromChunk(structuredChunkInput(envelope, rejectingLlm())))
      .rejects.toThrow("undeclared entity");
  });

  it("rejects v3 relation target endpoints outside the event entity closure", async () => {
    const envelope = validLineageV3Envelope();
    envelope.relations[0].target.name = "warehouse.missing_target";

    await expect(extractEventsFromChunk(structuredChunkInput(envelope, rejectingLlm())))
      .rejects.toThrow("undeclared entity");
  });

  it("rejects v3 contextTask outside the event task closure", async () => {
    const envelope = validLineageV3Envelope();
    envelope.relations[0].contextTask = "missing_task";

    await expect(extractEventsFromChunk(structuredChunkInput(envelope, rejectingLlm())))
      .rejects.toThrow("contextTask references undeclared entity");
  });

  it("rejects a v3 TABLE_DATA_FLOW relation when its required contextTask is missing", async () => {
    const envelope = validLineageV3Envelope({ category: "TABLE_DATA_FLOW" });
    delete envelope.relations[0].contextTask;

    await expect(extractEventsFromChunk(structuredChunkInput(envelope, rejectingLlm())))
      .rejects.toThrow("relation DATA_FLOW requires contextTask");
  });

  it("rejects v3 relations whose endpoint types violate the relation shape", async () => {
    const envelope = validLineageV3Envelope();
    envelope.relations[0].source = {
      type: "column",
      name: "stage.orders_work.order_id"
    };

    await expect(extractEventsFromChunk(structuredChunkInput(envelope, rejectingLlm())))
      .rejects.toThrow("relation DATA_FLOW requires table->table");
  });

  it("rejects v3 duplicate normalized entities with conflicting semantics before deduplication", async () => {
    const envelope = validLineageV3Envelope();
    envelope.entities.push({
      type: "table",
      name: " STAGE.ORDERS_WORK ",
      description: "Conflicting duplicate",
      semantics: { role: "business" }
    });

    await expect(extractEventsFromChunk(structuredChunkInput(envelope, rejectingLlm())))
      .rejects.toThrow("conflicting semantics");
  });

  it("rejects a v2 relation that references an undeclared entity", async () => {
    const extractWithLlm = vi.fn(async () => []);
    const llm: LlmClient = {
      extractNamedEntities: vi.fn(async () => []),
      rerankEvents: vi.fn(async () => []),
      extractEventsFromChunk: extractWithLlm
    };
    const envelope = {
      schema: "snw.sql_lineage_event.v2",
      title: "非法关系",
      summary: "关系目标没有声明。",
      content: "关系引用必须闭合。",
      category: "TABLE_DATA_FLOW",
      keywords: ["db.b", "db.c"],
      entities: [
        { type: "table", name: "db.b", description: "来源表" }
      ],
      relations: [
        {
          source: { type: "table", name: "db.b" },
          type: "DATA_FLOW",
          target: { type: "table", name: "db.c" }
        }
      ]
    };

    await expect(extractEventsFromChunk({
      llm,
      documentTitle: "task_a",
      heading: envelope.title,
      content: envelope.content,
      rawContent: `\`\`\`sag-event\n${JSON.stringify(envelope)}\n\`\`\``,
      references: []
    })).rejects.toThrow("undeclared entity");
    expect(extractWithLlm).not.toHaveBeenCalled();
  });

  it("rejects malformed structured SAG event JSON instead of falling back to the LLM", async () => {
    const extractWithLlm = vi.fn(async () => []);
    const llm: LlmClient = {
      extractNamedEntities: vi.fn(async () => []),
      rerankEvents: vi.fn(async () => []),
      extractEventsFromChunk: extractWithLlm
    };

    await expect(extractEventsFromChunk({
      llm,
      documentTitle: "lineage_task",
      heading: "坏事件",
      content: "坏事件",
      rawContent: "## 坏事件\n\n```sag-event\n{not-json}\n```",
      references: []
    })).rejects.toThrow("Invalid structured SAG event");
    expect(extractWithLlm).not.toHaveBeenCalled();
  });

  it("rejects uncontrolled entity types in a structured SAG event", async () => {
    const extractWithLlm = vi.fn(async () => []);
    const llm: LlmClient = {
      extractNamedEntities: vi.fn(async () => []),
      rerankEvents: vi.fn(async () => []),
      extractEventsFromChunk: extractWithLlm
    };
    const envelope = {
      schema: "snw.sql_lineage_event.v1",
      title: "错误实体",
      summary: "错误实体类型不应被摄取。",
      content: "subject 不是 SQL 血缘实体类型。",
      category: "COLUMN_TO_COLUMN_LINEAGE",
      keywords: ["subject"],
      entities: [
        { type: "subject", name: "Users", description: "错误实体" }
      ]
    };

    await expect(extractEventsFromChunk({
      llm,
      documentTitle: "lineage_task",
      heading: envelope.title,
      content: envelope.content,
      rawContent: `## ${envelope.title}\n\n\`\`\`sag-event\n${JSON.stringify(envelope)}\n\`\`\``,
      references: []
    })).rejects.toThrow("Invalid structured SAG event");
    expect(extractWithLlm).not.toHaveBeenCalled();
  });

  it("deduplicates structured entities by type and normalized name", async () => {
    const extractWithLlm = vi.fn(async () => []);
    const llm: LlmClient = {
      extractNamedEntities: vi.fn(async () => []),
      rerankEvents: vi.fn(async () => []),
      extractEventsFromChunk: extractWithLlm
    };
    const envelope = {
      schema: "snw.sql_lineage_event.v1",
      title: "字段来源表：target_table.result_col 来自 source_table",
      summary: "目标字段来自 source_table。",
      content: "target_table.result_col 来自 source_table。",
      category: "TABLE_TO_COLUMN_LINEAGE",
      keywords: ["target_table.result_col", "source_table"],
      entities: [
        { type: "task", name: "lineage_task", description: "SQL 血缘任务" },
        { type: "table", name: "source_table", description: "上游表" },
        { type: "table", name: " SOURCE_TABLE ", description: "重复的上游表" },
        { type: "column", name: "target_table.result_col", description: "目标字段" }
      ]
    };

    const [event] = await extractEventsFromChunk({
      llm,
      documentTitle: "lineage_task",
      heading: envelope.title,
      content: envelope.content,
      rawContent: `\`\`\`sag-event\n${JSON.stringify(envelope)}\n\`\`\``,
      references: []
    });

    expect(event.entities).toEqual([
      { type: "task", name: "lineage_task", description: "SQL 血缘任务" },
      { type: "table", name: "source_table", description: "上游表" },
      { type: "column", name: "target_table.result_col", description: "目标字段" }
    ]);
    expect(extractWithLlm).not.toHaveBeenCalled();
  });

  it("keeps one event per chunk even if the LLM client returns multiple events", async () => {
    const llm: LlmClient = {
      extractNamedEntities: vi.fn(async () => []),
      rerankEvents: vi.fn(async () => []),
      extractEventsFromChunk: vi.fn(async () => [
        {
          title: "第一个事项",
          summary: "第一个事项摘要",
          content: "第一个事项内容",
          category: "一般事项",
          keywords: ["第一个事项"],
          references: [],
          entities: []
        },
        {
          title: "第二个事项",
          summary: "第二个事项摘要",
          content: "第二个事项内容",
          category: "一般事项",
          keywords: ["第二个事项"],
          references: [],
          entities: []
        }
      ])
    };

    const events = await extractEventsFromChunk({
      llm,
      documentTitle: "测试文档",
      heading: "测试章节",
      content: "测试章节包含多个事实，但当前系统每个切片只保留一个事项。",
      rawContent: "## 测试章节\n\n测试章节包含多个事实，但当前系统每个切片只保留一个事项。",
      references: ["00000000-0000-0000-0000-000000000001"]
    });

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("第一个事项");
    expect(events[0].references).toEqual(["00000000-0000-0000-0000-000000000001"]);
  });
});

function rejectingLlm(): LlmClient {
  return {
    extractNamedEntities: vi.fn(async () => []),
    rerankEvents: vi.fn(async () => []),
    extractEventsFromChunk: vi.fn(async () => {
      throw new Error("the LLM must not be called for a structured event");
    })
  };
}

function structuredChunkInput<T extends { title: string; content: string }>(envelope: T, llm: LlmClient) {
  return {
    llm,
    documentTitle: "lineage",
    heading: envelope.title,
    content: envelope.content,
    rawContent: `\`\`\`sag-event\n${JSON.stringify(envelope)}\n\`\`\``,
    references: []
  };
}

function validV2Envelope() {
  return {
    schema: "snw.sql_lineage_event.v2",
    title: "Names do not imply lineage semantics",
    summary: "A business-looking work table writes a tmp-named business table.",
    content: "stage.orders_work flows to analytics.tmp_customer_snapshot.",
    category: "TABLE_DATA_FLOW",
    keywords: ["build_order_fact", "stage.orders_work", "analytics.tmp_customer_snapshot"],
    entities: [
      { type: "task", name: "build_order_fact", description: "task" },
      { type: "table", name: "stage.orders_work", description: "source table" },
      { type: "table", name: "analytics.tmp_customer_snapshot", description: "target table" }
    ],
    relations: [{
      source: { type: "table", name: "stage.orders_work" },
      type: "DATA_FLOW",
      target: { type: "table", name: "analytics.tmp_customer_snapshot" },
      contextTask: "build_order_fact"
    }]
  };
}
