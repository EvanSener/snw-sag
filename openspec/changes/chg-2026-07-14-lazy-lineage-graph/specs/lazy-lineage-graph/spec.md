# 分层血缘图增量规范

## ADDED Requirements

### Requirement: v2 信封关系必须严格校验并事务写入

系统 MUST 接受 `snw.sql_lineage_event.v2`，关系两端和任务上下文 MUST 引用信封内已声明实体；任何无效引用 MUST 终止文档摄取且不得部分写入。

#### Scenario: 合法任务产出关系

- **WHEN** 信封声明 task、table 和 `task -> PRODUCES -> table`
- **THEN** 事件、实体和类型关系在同一事务提交

### Requirement: 类型化图不得把事件共现当作直接关系

血缘图 MUST 只读取 `lineage_relations`，MUST NOT 因任务和来源表共同出现在一个事件中而生成任务到来源表的边。

#### Scenario: 带任务上下文的表数据流

- **WHEN** 事件包含任务 A、来源表 B、目标表 C 和 `B -> DATA_FLOW -> C`
- **THEN** 图只显示 B 到 C 的数据流并标注任务 A
- **AND** 不显示 A 到 B 的直接边

### Requirement: 图 API 必须按需加载

无参数请求 MUST 只返回任务产出骨架及从既有类型关系推导的任务依赖；节点请求 MUST 只返回一跳关系；所有请求 MUST 有服务端上限和 `hasMore`。

#### Scenario: 大型项目首屏

- **WHEN** 项目包含几万字段
- **THEN** 首屏响应不包含字段节点
- **AND** 响应大小由 `limit` 控制

### Requirement: 图谱 UI 必须支持搜索和增量展开

图谱页 MUST 支持 task/table/column 搜索、单节点展开和重置，MUST NOT 提供全图展开；累计节点达到上限时 MUST 阻止继续合并并给出状态提示。

#### Scenario: 从中间表查生产任务

- **WHEN** 用户搜索并展开中间表 B
- **THEN** UI 显示 B 的 `PRODUCES` 入边和生产任务
- **AND** 同时显示受上限约束的上下游表与字段关系
