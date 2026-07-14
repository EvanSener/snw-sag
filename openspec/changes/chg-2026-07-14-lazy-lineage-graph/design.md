# Design: 分层加载血缘图

## 数据模型

`lineage_relations` 保存 `source_id`、证据事件、源实体、目标实体、关系类型、可选任务上下文和元数据。唯一键按事件、源、目标和关系类型约束；查询投影按语义边聚合重复证据。

核心索引覆盖：

- `(source_id, relation_type)`：首屏 `PRODUCES` 骨架。
- `(source_id, source_entity_id)`：下游展开。
- `(source_id, target_entity_id)`：上游和生产任务展开。
- `(source_id, context_task_entity_id)`：按任务上下文定位。
- 既有实体 trigram/FTS 索引用于节点搜索。

## API

`GET /api/projects/:projectId/lineage-graph`：

- 无参数：只返回受上限约束的 `PRODUCES` 骨架。
- `nodeId`：返回该节点的一跳入边、出边和任务上下文。
- `query`：返回匹配 task/table/column 节点，随后由客户端按节点展开。
- `limit`：服务端限制在安全范围，响应返回 `hasMore`。

## 前端

项目工作区不再预取完整事件图。图谱页优先请求类型化骨架，任务、表、字段采用三类稳定视觉样式；单击节点增量合并邻居，搜索替换当前视图，重置回骨架。前端最多保留 500 个可见节点，避免 React Flow 布局和 DOM 失控。

## 兼容

v1 信封继续按原逻辑写入事件和实体，不产生类型关系。没有 `lineage_relations` 的项目在进入图谱页后才按需加载上游事件图。
