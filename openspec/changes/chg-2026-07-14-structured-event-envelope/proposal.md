# Proposal: 支持确定性结构化事件信封

## 为什么

SAG 当前只通过 LLM 或通用本地规则从文档文本猜测事件和实体，无法让 SQL 血缘等已经具备确定事实的数据源精确声明事件、实体名称和实体类型，导致图谱出现文本噪声实体。

## 变更内容

1. 在 `heading_strict` chunk 中识别 `sag-event` JSON 代码块。
2. 校验 `snw.sql_lineage_event.v1` 信封并直接转换为 SAG `ExtractedEvent`。
3. 增加 `task`、`table`、`column` 三种实体类型种子和类型保留逻辑。
4. 结构化信封解析成功时跳过 LLM/fallback；无效信封显式失败。
5. 普通 Markdown/TXT 沿用上游既有抽取行为。

## 能力范围

### 新增能力

- `structured-event-ingestion`: 版本化结构化事件及受控实体的确定性摄取。

### 修改能力

- None。

## 影响范围

- `src/ingestion/extract/`、chunk 到事件的调用契约、实体类型种子、单元测试和项目文档。
- 不修改搜索、多跳扩展、普通文档抽取和 WebUI API。
