# Proposal: Answer-safe 血缘工作台

## 为什么

当前类型化血缘把摄取到的任务、业务表、临时表和只用于举证的中间实体放在同一张图中。完整事实虽然得以保留，但主画布、API、MCP 和自然语言答案都可能直接暴露 `tmp`/`temp` 等中间对象，用户难以区分“最终业务答案”和“用于证明答案的加工过程”。现有 v1/v2 结构化事件也没有实体语义字段，SAG 无法在不猜测名称的前提下可靠区分业务实体与临时实体。

二维血缘工作台还存在三类可验证缺口：表字段只有有限展开，任务和表没有独立的上游/下游折叠；ELK 只产出节点坐标，React Flow 重新生成边，无法保证端口、正交路由和零歧义交叉；筛选、穿透预算、检查器统计和 1280/1440 视口布局的口径不一致。现有浏览器脚本也未把这些约束纳入 CI。

## 变更内容

1. 新增 `snw.sql_lineage_event.v3`。每个 v3 实体显式声明 `semantics.role`，取值为 `business`、`temporary` 或 `evidence_only`，并持久化到 `entities.metadata.lineageSemantics`；事件按双仓冻结的严格 wire schema 携带 Repository/File/Statement、相对路径、源码范围、内容哈希、可空 Git commit、方言和解析器版本等结构化 evidence，并写入 `events.metadata.sqlLineageEvidence`。v1/v2 继续兼容，且 SAG 不根据实体名称、前后缀或正则猜测临时表。
2. 保留包含所有任务、表、字段和关系的 evidence graph；新增 answer graph 投影。answer graph、默认血缘 HTTP API 和答案型 MCP 输出隐藏 `temporary`/`evidence_only` 端点，以 `evidencePathSummaries` 保留不含隐藏名称的可追溯摘要；通用 `sag_search` 继续是显式证据召回接口。
3. 类型化血缘的最终自然语言答案由服务端确定性渲染。服务端先从 answer graph 生成带 canonical provenance 的业务 fact，模型只能选择 `answerFactId`，不能提交自由正文、端点或证据引用；服务端校验 fact 属于当前授权图 revision 后，仅用该 fact 内的业务实体显示名、公开关系标签和固定模板组装答案。临时链的名称、描述、别名、SQL、表达式和加工步骤均不进入答案渲染输入。
4. Web 默认展示业务 answer graph。临时或证据路径在主画布中收敛为不含中间实体名称的可点击证据胶囊，点击后在血缘检查器加载完整 evidence path；中间链不进入默认答案正文和主画布节点集合。
5. 任务和表节点支持分别折叠上游与下游，字段列表独立展开/收起；折叠只改变视图投影，不删除已加载缓存或 evidence graph。
6. 继续使用 React Flow + ELK。ELK 接收真实端口并返回 edge sections，自定义边按返回的正交折线渲染；自动布局节点默认固定，禁止自由拖动制造重叠。布局后执行节点重叠、边穿节点、边重叠和非端点交叉几何审计。
7. 可平面化的主图必须达到节点重叠、边穿节点和非端点交叉均为 0；非平面或冲突关系按稳定优先级收进证据束和检查器，不在主画布绘制已知交叉线。
8. 修复筛选后遍历仍消耗隐藏节点预算、1280/1440 检查器覆盖画布，以及 evidence/answer/canvas 统计混用的问题。
9. 使用固定 Playwright fixture 在 CI 验收桌面、平板和移动视口，不依赖本机数据库项目、macOS Chrome 路径或人工截图判断。

## 能力范围

### 新增能力

- `answer-safe-lineage-workbench`: 覆盖 v3 实体语义、evidence/answer 双图投影、服务端答案安全校验、证据胶囊、独立折叠、端口感知正交布局、几何审计、响应式检查器和 CI 浏览器验收。

### 修改能力

- None。

## 影响范围

- 摄取与持久化：`src/types.ts`、`src/ingestion/extract/structured-event.ts`、`src/services/ingestion-service.ts`、`src/db/repositories.ts`。现有 `entities.metadata` 足以承载语义，不新增数据库列。
- 图投影与接口：血缘 repository/service、`src/api/server.ts`、Web/MCP 共享类型和新的 evidence path 详情接口。
- 答案出口：`src/services/mcp-agent-service.ts`、`src/mcp/server.ts` 及共享的 answer projector、canonical fact、selection validator 与 renderer；通用 `sag_search` 继续作为证据召回接口，不改变其检索算法和普通文档返回契约。
- Web 工作台：`web/src/components/LineageGraphFlow.tsx`、`web/src/components/lineage-graph/`、`web/src/lib/lineage-graph-model.ts`、`web/src/lib/api.ts` 和类型定义。
- 验证：结构化事件、持久化、投影、MCP、答案校验、布局几何、折叠与遍历单元测试，以及 Playwright fixture 和 GitHub Actions。
- 本变更不实现 SQL 解析、SQL 文件监听、增量索引或跨仓索引内核；这些事实由上游 SQL 血缘生产仓生成 v3 信封。本变更不引入新的图渲染或布局引擎。
