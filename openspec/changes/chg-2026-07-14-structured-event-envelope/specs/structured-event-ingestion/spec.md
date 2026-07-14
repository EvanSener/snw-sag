# 结构化事件摄取增量规范

## ADDED Requirements

### Requirement: SAG 必须优先解析结构化事件信封

当 `heading_strict` chunk 包含 `sag-event` 代码块时，系统 MUST 解析 `snw.sql_lineage_event.v1` 信封并直接写入事件，MUST NOT 再调用 LLM 或本地文本实体抽取。

#### Scenario: 有效 SQL 血缘事件

- **WHEN** chunk 包含合法标题、正文、分类、关键词和实体数组
- **THEN** SAG 保存值相同的一个事件
- **AND** 事件只关联信封声明的实体

### Requirement: 结构化 SQL 实体类型必须受控

`snw.sql_lineage_event.v1` 实体类型 MUST 限于 `task`、`table`、`column`，实体名称 MUST 非空且按类型和规范化名称去重。

#### Scenario: 三类实体正常写入

- **WHEN** 一个事件声明任务、两张表和三个字段
- **THEN** 实体 API 返回对应的 `task`、`table`、`column` 类型
- **AND** 不得额外出现从正文猜测的实体

### Requirement: 无效信封必须终止摄取

已包含 `sag-event` 标记但不满足 schema 的 chunk MUST 抛出可定位错误，MUST NOT 静默进入普通抽取流程。

#### Scenario: 不支持的实体类型

- **WHEN** 信封声明 `subject` 实体
- **THEN** 文档摄取失败并说明实体类型不受支持
- **AND** 事务不得写入部分事件或实体

### Requirement: 普通文档必须保持兼容

不包含 `sag-event` 代码块的文档 MUST 继续调用现有 LLM 或本地 fallback 抽取流程。

#### Scenario: 普通 Markdown

- **WHEN** chunk 只有普通 Markdown 正文
- **THEN** extractor 的输出与本扩展前一致

### Requirement: 上传传输层必须覆盖既有文档大小契约

同步和异步文档上传路由 MUST 接受业务层既有 `5 MiB` 文档限制内的 JSON 请求，MUST NOT 被 Fastify 默认 `1 MiB` body limit 提前拒绝；其他 API 继续使用默认限制。

#### Scenario: 结构化文档超过 1 MiB

- **WHEN** 上传请求体超过 `1 MiB` 但文档内容仍在业务限制内
- **THEN** 请求进入上传参数和业务校验
- **AND** 不得返回 `Request body is too large`
