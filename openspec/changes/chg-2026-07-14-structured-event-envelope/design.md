# Design: 结构化事件优先的兼容摄取

## 背景

每个 `heading_strict` section 已天然对应一个 chunk 和一个事件候选，但现有 extractor 只接收去 Markdown 后的文本，结构化代码块会被移除。需要在通用抽取前读取 chunk 的 `rawContent`。

## 目标 / 非目标

**目标：**

- 确定性保留调用方提供的事件标题、正文、分类、关键词和实体。
- 支持 `task/table/column` 实体类型。
- 无效结构化数据不产生部分事件或 fallback 噪声。
- 普通文档行为与上游一致。

**非目标：**

- 不开放任意数据库写入接口。
- 不改变 SAG 检索、图扩展和普通文档 LLM 提示词。

## 设计决策

### 信封位置

调用方在每个 Markdown section 中放置一个 `sag-event` fenced code block。chunker 已保存 `rawContent`，ingestion service 将它传给 extractor。

### 校验与优先级

extractor 先检测 `sag-event` 代码块。存在时必须解析为 `snw.sql_lineage_event.v1`，并校验必填字符串、关键词数组、实体数组、实体类型和名称；成功后直接返回一个 `ExtractedEvent`。不存在代码块时才调用原有 LLM client。

### 实体类型

实体类型种子新增 `task`、`table`、`column`。结构化信封只允许这三种类型；普通抽取仍保留上游通用类型集合。

## 风险 / 权衡

- fenced JSON 增加文档体积，但保持 API 向后兼容且不需要新增写库接口。
- 调用方可能提供过长事件；继续受既有 chunk 与字段长度约束。
- 新类型需要再次执行 `npm run seed`；seed 使用 upsert，可重复执行。

## 迁移方案

1. 部署代码并执行 `npm run db:setup` 或 `npm run seed`。
2. 创建新项目摄取结构化文档，验证后再归档旧项目。
3. 回滚时恢复上游版本；已有新类型和事件记录不会破坏旧代码读取。
