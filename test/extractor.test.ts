import { describe, expect, it, vi } from "vitest";
import { extractEventsFromChunk } from "../src/ingestion/extract/extractor.js";
import type { LlmClient } from "../src/ai/llm-client.js";

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
