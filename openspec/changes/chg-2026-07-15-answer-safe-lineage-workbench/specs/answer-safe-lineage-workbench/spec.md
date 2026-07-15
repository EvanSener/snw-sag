# Answer-safe 血缘工作台规范

## ADDED Requirements

### Requirement: v3 结构化事件必须显式声明实体语义

`snw.sql_lineage_event.v3` 中每个 task、table、column 实体 MUST 携带严格的 `semantics.role`，且 role MUST 为 `business`、`temporary` 或 `evidence_only`。v3 MUST 继承 v2 的关系端点与 `contextTask` 引用闭包和现有五类 category：`TASK_PRODUCES_TABLE`、`TABLE_DATA_FLOW`、`SQL_TABLE_JOIN`、`TABLE_TO_COLUMN_LINEAGE`、`COLUMN_TO_COLUMN_LINEAGE`。事件 `evidence` MUST 严格使用 `repositoryId`、`fileId`、`statementId`、`relativePath`、`contentHash`、可空 `gitCommit`、`dialect`、`parserVersion` 和 `span`，并 MUST 拒绝未知字段。三个 ID MUST 是对应前缀加 64 位小写 SHA-256 十六进制；`contentHash` MUST 是不带算法前缀的 64 位小写十六进制；`gitCommit` 非空时 MUST 是 40 或 64 位小写十六进制；`relativePath` MUST 是无 `..` 的 POSIX 相对路径。`span.startByte` MUST 为含端、`span.endByte` MUST 为不含端，行列 MUST 为 1-based；content hash MUST 只在 evidence 顶层出现。系统 MUST 将实体语义持久化到 `entities.metadata.lineageSemantics`，并将事件锚点持久化到 `events.metadata.sqlLineageEvidence`，MUST NOT 覆盖其他 metadata。

#### Scenario: 摄取带临时表的合法 v3 事件

- **WHEN** v3 信封把目标表声明为 `business`、中间表声明为 `temporary`
- **THEN** 事件、实体、关系和全部实体各自的语义在同一事务提交
- **AND** 临时表的 metadata 记录 `role=temporary` 与 v3 schema 来源
- **AND** 事件 metadata 保存可回到 SQL 事实源的相对路径、Statement ID 和 SourceSpan
- **AND** 关系端点和 `contextTask` 均引用同一事件中已声明且类型匹配的实体

#### Scenario: v3 evidence 使用绝对路径或非法范围

- **WHEN** v3 信封的 evidence 包含绝对源码路径，或 SourceSpan 起止顺序非法
- **THEN** 整个结构化事件摄取失败并返回可定位的字段错误
- **AND** 不得写入部分事件、实体或关系

#### Scenario: v3 关系引用未声明 contextTask

- **WHEN** v3 关系的 `contextTask` 未在同一事件声明为 task 实体
- **THEN** 整个结构化事件摄取失败并返回可定位的闭包错误
- **AND** 不得写入部分事件、实体或关系

#### Scenario: 同一实体出现冲突语义

- **WHEN** 已有 v3 实体被另一个 v3 信封声明为不同 role
- **THEN** 本次摄取失败并返回可定位的语义冲突错误
- **AND** 不得写入部分事件、实体或关系

### Requirement: v1/v2 与普通文档必须保持兼容且不得名称猜测

系统 MUST 继续接受 v1/v2 结构化信封和普通文档；v1/v2 MUST NOT 写入或清除 `lineageSemantics`。缺少显式语义的历史实体 MUST 按兼容业务实体处理，系统 MUST NOT 根据 `tmp`、`temp`、前后缀、数据库名或正则表达式推断实体 role。

#### Scenario: v2 实体名称包含 tmp

- **WHEN** v2 信封声明名称包含 `tmp` 的表但没有实体语义
- **THEN** 摄取和既有 v2 行为一致
- **AND** SAG 不得仅凭名称将该实体重分类为 `temporary`

#### Scenario: v3 为历史实体补齐语义

- **WHEN** 一个无 `lineageSemantics` 的历史实体首次收到一致的 v3 显式声明
- **THEN** 系统合并写入该语义且保留既有 metadata

### Requirement: Evidence graph 必须完整且 answer graph 必须隐藏非业务端点

系统 MUST 完整保留 evidence graph 中所有已摄取实体和关系；answer graph MUST 隐藏 role 为 `temporary` 或 `evidence_only` 的端点，MUST 保留业务实体间的直接关系，并 MUST 将经过隐藏实体的路径投影为稳定 `evidencePathSummaries`，不得删除底层证据。

#### Scenario: 两个业务表之间经过临时表

- **WHEN** evidence graph 存在 `business A -> temporary T -> business B`
- **THEN** answer graph 只返回 A、B 和它们之间的投影关系
- **AND** `evidencePathSummaries` 记录隐藏步骤数、关系类型、事件和证据数，但不包含 T 的名称、节点 ID 或可反推出 T 的字段

#### Scenario: 查询完整证据路径

- **WHEN** 已授权用户按 answer graph 返回的 pathId 请求详情
- **THEN** 系统返回该路径的完整有序节点、关系、语义角色和事件证据
- **AND** evidence graph 的临时节点仍保持原始实体 ID和关系

### Requirement: HTTP 与 MCP 的默认血缘投影必须是 answer graph

类型化血缘 HTTP API、Web 默认请求和答案型 MCP 工具 MUST 默认返回 answer graph；完整 evidence graph 或 evidence path 详情 MUST 通过显式参数或显式工具请求。默认响应 MUST 隐藏非业务端点，同时 MUST 返回可追溯的 `evidencePathSummaries`。SAG pathId MUST 使用 `sagpath:` 前缀并只在当前租户、项目和已摄取图 revision 内有效，MUST NOT 写入 v3 或接受 SQL lineage 签发的 `sqlpath:`。一次 answer projection、canonical fact 校验与渲染 MUST 固定在同一 graph revision；revision 在处理中改变时 MUST 取消并重试，无法重试时 MUST fail closed。SAG MUST NOT 声称实时回查 SQLite；答案只保证与已摄取 v3 evidence revision 一致。

#### Scenario: MCP 精确血缘工具命中临时加工链

- **WHEN** `sag_trace_lineage` 查询的确定性路径包含业务表之间的临时节点
- **THEN** 默认工具结果只暴露业务 answer graph 和 `evidencePathSummaries`
- **AND** 调用方必须显式调用 `sag_get_lineage_evidence_path` 才能看到完整中间链

#### Scenario: SAG 详情接口收到外部或过期 pathId

- **WHEN** `sag_get_lineage_evidence_path` 收到 `sqlpath:` 或不属于当前租户、项目与图 revision 的 `sagpath:`
- **THEN** 工具明确拒绝该 ID 且不得跨服务或跨项目补取详情

#### Scenario: 答案生成期间图 revision 改变

- **WHEN** answer projection 完成后、canonical fact 渲染前项目图 revision 发生改变
- **THEN** 系统取消旧 revision 的结果并在新 revision 重试
- **AND** 无法完成一致 revision 重试时返回固定安全失败响应，不混合两个 revision 的证据

### Requirement: 通用 SAG 检索必须保持证据召回兼容

`sag_search` MUST 继续返回既有 sections 与 trace，并 MUST 保持普通文档和结构化事件的检索算法兼容；系统 MUST NOT 把该通用证据工具改造成确定性血缘答案接口。类型化血缘答案 MUST 使用 answer projector 与精确血缘工具。

#### Scenario: 普通文档调用 sag_search

- **WHEN** 调用方对未携带结构化血缘信封的普通项目调用 `sag_search`
- **THEN** sections、trace 和多跳检索行为与变更前一致
- **AND** 不要求普通文档提供 lineage semantics 或 evidence path

### Requirement: 最终自然语言答案必须由服务端从 canonical fact 确定性渲染

所有使用类型化血缘生成的最终自然语言答案 MUST 由服务端从当前 answer graph 和查询方向生成端点、answer relation、pathIds、eventIds、evidenceCount 闭合绑定的 canonical fact。LLM 只能返回当前授权 graph revision 内的 `answerFactIds`，MUST NOT 返回自由正文、端点、关系、证据引用，或名称、描述、别名、SQL、表达式、加工步骤等字段。服务端 MUST 按 fact ID 读取 canonical provenance，并 MUST 只使用业务实体 displayName、公开关系标签、方向、证据数量和固定模板生成答案；隐藏实体 metadata、原始事件文本与完整 evidence path MUST NOT 进入 renderer。模型 token MUST NOT 直接流式发送给客户端。

#### Scenario: 模型尝试返回隐藏名称或语义改写

- **WHEN** LLM 输出包含自由正文、隐藏名称，或不含原名但复述中间表描述、SQL 表达式和加工步骤的额外字段
- **THEN** 严格 selection schema 因未知字段拒绝整个候选
- **AND** 一次受控重试仍失败时返回固定安全失败响应，不返回任何模型文本

#### Scenario: 模型读取详情后选择合法业务 fact

- **WHEN** 模型显式读取完整 evidence path 后只返回当前 graph revision 内的合法 answerFactId
- **THEN** 服务端仅从该 canonical fact 绑定的业务端点、关系和 provenance 确定性渲染答案
- **AND** evidence path 的隐藏名称、描述、别名、SQL、表达式和加工步骤均不进入答案正文

#### Scenario: 模型尝试拼接已授权但不相关的证据

- **WHEN** 模型除 answerFactId 外提交另一个已授权但不属于该 fact 的 relation、eventId 或 pathId
- **THEN** 严格 selection schema 拒绝额外引用字段
- **AND** renderer 只使用服务端为该 fact 生成的 canonical provenance

#### Scenario: answerFactId 不属于当前上下文

- **WHEN** selection 包含其他租户、项目、查询上下文或旧 graph revision 的 answerFactId
- **THEN** 服务端拒绝整个 selection 且不得跨项目补取事实

### Requirement: Web 主画布必须默认显示业务答案图和证据胶囊

类型化血缘 Web MUST 默认只为 answer graph 业务实体创建主画布节点；经过临时或 evidence-only 实体的路径 MUST 显示为不含隐藏名称的可点击证据胶囊。完整中间链 MUST 在检查器中按需展示，MUST NOT 进入默认答案正文或主画布节点集合。

#### Scenario: 点击证据胶囊

- **WHEN** 用户点击标有隐藏步骤数和证据数的胶囊
- **THEN** 右侧检查器加载并按顺序展示完整 evidence path
- **AND** 主画布继续只显示业务节点和无交叉的业务关系

### Requirement: 节点与字段必须支持独立可逆折叠

任务和表节点 MUST 分别支持折叠上游和下游；表字段 MUST 使用独立的展开/收起状态。折叠 MUST 只改变 canvas 投影，MUST NOT 删除 answer graph、evidence graph 或已加载缓存；重新展开 MUST 无需重新摄取并恢复相同实体和关系。

#### Scenario: 只折叠表的上游

- **WHEN** 用户折叠业务表 B 的上游但保持下游展开
- **THEN** B 的上游分支收敛为带数量的边界胶囊且下游继续显示
- **AND** 再次展开后从缓存恢复原上游实体和关系

#### Scenario: 收起表字段

- **WHEN** 用户收起已展开的表字段列表
- **THEN** 表卡片恢复紧凑高度并重新生成主端口路由
- **AND** 选中的字段仍保持可见且底层字段血缘不被删除

### Requirement: ELK 布局必须使用真实端口并保留正交边路由

ELK 输入 MUST 包含任务、表和可见字段的稳定端口及固定顺序；布局结果 MUST 保留 edge sections、折点和端口映射，并由自定义 React Flow 正交边原样渲染。自动布局节点 MUST 固定，MUST NOT 允许自由拖动破坏已审计布局。

#### Scenario: 展开字段后重新布局

- **WHEN** 表卡片展开并增加字段行端口
- **THEN** ELK 使用更新后的节点高度和字段端口重新布局
- **AND** 字段关系连接到正确字段行且箭头指向目标端口

### Requirement: 主画布必须通过几何审计且不得绘制已知交叉线

布局后系统 MUST 以固定 `epsilon=0.5` CSS px 审计节点重叠、边穿节点、未声明共线重叠和非端点交叉；小于或等于 epsilon 的距离视为接触。边只可在自身声明的源/目标端口接触节点，只可在双方共同声明的同一端口与其他边相交。可平面化主图的四项计数 MUST 为 0；非平面或仍冲突的关系 MUST 按“当前选中路径优先、直接业务关系优先、evidenceCount 降序、稳定 edge ID 升序”的顺序保留，其余收进证据束和检查器，MUST NOT 在主画布绘制已知交叉线。

#### Scenario: 可平面化的扇入扇出图

- **WHEN** answer graph 可通过端口排序和正交路由平面化
- **THEN** 节点重叠、边穿节点、共线重叠和非端点交叉计数均为 0

#### Scenario: 非平面关系集合

- **WHEN** answer graph 包含无法同时无交叉绘制的关系集合
- **THEN** 系统按稳定优先级保留主画布关系并把冲突关系收进证据束
- **AND** 检查器仍可查看所有关系且主画布非端点交叉计数为 0

### Requirement: 穿透预算必须基于筛选后的当前投影

1-5 层穿透 MUST 以已经应用 answer/evidence 视图、实体筛选和关系筛选的图为输入；被隐藏的实体和关系 MUST NOT 进入 BFS frontier，也 MUST NOT 消耗请求预算或 500 节点预算。切换筛选、项目或视图 MUST 取消迟到请求。

#### Scenario: 字段和字段关系已隐藏

- **WHEN** 用户隐藏字段后对业务表执行两层穿透
- **THEN** 字段节点与字段关系不进入遍历 frontier
- **AND** 它们不占用请求次数和可见节点上限

### Requirement: 检查器与统计必须使用明确且一致的口径

工作台 MUST 分别展示 evidence 已加载、answer graph、canvas 可见、语义隐藏、用户折叠和证据束数量；可见关系统计 MUST NOT 包含未绘制的 `HAS_COLUMN` 或已经收进证据束的关系。检查器中的关系列表 MUST 标明当前显示数量与总数。

#### Scenario: 证据和折叠同时存在

- **WHEN** answer graph 含隐藏证据路径且用户又折叠一个下游分支
- **THEN** 检查器分别报告语义隐藏数和用户折叠数
- **AND** canvas 节点/边计数与实际渲染元素一致

### Requirement: 桌面检查器不得覆盖中央画布

工作台 MUST 根据容器宽度选择三栏或抽屉布局。在 1280 和 1440 桌面视口，即使项目侧栏保持展开，持续可见的控制区和检查器 MUST 占据预留布局列，MUST NOT 以浮层覆盖中央画布；中央画布宽度 MUST 不小于 480 px，检查器与画布 bounding box 的交集面积 MUST 为 0。空间不足时的抽屉 MUST 可关闭且完全位于视口内。

#### Scenario: 1280 与 1440 视口选择业务表

- **WHEN** 用户分别在 1280 与 1440 宽桌面视口保持项目侧栏展开并选择业务表
- **THEN** 检查器在预留右栏显示、与中央画布 bounding box 交集面积为 0，且画布宽度不小于 480 px
- **AND** 画布仍可平移、缩放和点击节点

### Requirement: 浏览器验收必须使用确定性 fixture 并进入 CI

项目 MUST 使用仓库内固定 answer/evidence fixture 执行 Playwright 验收，MUST 覆盖 390、768、1280、1440、1720 视口，并 MUST 在 CI 验证证据胶囊、完整检查器链、可逆折叠、筛选预算、面板边界和几何审计。验收 MUST NOT 依赖固定本机项目 UUID、macOS Chrome 路径或人工截图判断。

#### Scenario: Linux CI 执行血缘浏览器验收

- **WHEN** GitHub Actions 安装 Chromium 并启动 fixture 应用
- **THEN** 五种视口的交互和几何断言全部自动执行
- **AND** 失败任务上传截图、DOM 快照和几何审计 JSON 作为证据

### Requirement: 本能力不得承担 SQL 索引内核职责或更换图引擎

本能力 MUST 只消费结构化血缘事实并完成摄取、投影、答案安全和展示；MUST NOT 在 SAG 中实现 SQL 解析、SQL 文件监听或增量索引，也 MUST NOT 引入新的图渲染或布局引擎替换 React Flow + ELK。

#### Scenario: 上游提供 v3 血缘事实

- **WHEN** SQL 血缘生产仓输出合法 v3 信封
- **THEN** SAG 校验、持久化、投影并展示该事实
- **AND** SAG 不重新解析原始 SQL 来猜测实体或关系
