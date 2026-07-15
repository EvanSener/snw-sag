# Design: Answer-safe 血缘工作台

## 背景

SAG 当前把结构化事件投影为一张完整类型化图。该图适合作为证据事实源，却不适合直接充当业务答案：临时表、过渡任务和仅用于证明路径的字段会与最终业务实体同等暴露。仅在提示词里要求模型忽略临时表无法形成可靠边界；按 `tmp`、`temp` 或名称模式判断也会误伤真实业务表，并与“结构化事实优先”的项目边界冲突。

现有 React Flow + ELK 实现已经具备左右分层节点，但 ELK 输入没有字段端口，输出也只保留节点坐标，最终边由 React Flow `smoothstep` 再计算。字段展开、节点穿透和筛选会改变端口与可见图，却没有可重复的边路由和几何验收。工作台还把已加载 evidence 数量、answer graph 数量和画布折叠后的数量混为一组统计。

## 目标 / 非目标

**目标：**

- 以显式 v3 实体语义区分业务答案实体、临时实体和只用于举证的实体，并持久化语义。
- 同时提供完整 evidence graph 和安全 answer graph，所有答案出口共享同一投影与服务端校验。
- 让默认 Web 主画布只展示业务答案图，通过证据胶囊和检查器保留完整可追溯性。
- 提供方向独立的节点折叠、字段折叠、端口感知正交边和可自动计算的零歧义交叉验收。
- 修复筛选遍历预算、统计口径、检查器覆盖和浏览器 CI 缺口。

**非目标：**

- 不在 SAG 内解析 SQL、监听 SQL 文件或实现增量 SQL 索引。
- 不根据名称、前后缀、数据库名或正则表达式推断实体语义。
- 不删除、改写或压缩 evidence graph 中已经摄取的临时节点和关系。
- 不用提示词替代服务端答案校验。
- 不引入 yFiles、AntV X6、G6、Cytoscape 或其他新图引擎；继续使用 React Flow + ELK。

## 设计决策

### 1. v3 实体语义契约

`snw.sql_lineage_event.v3` 继承 v2 的事件字段、关系端点与 `contextTask` 引用闭包、关系形状校验和现有五类 category：`TASK_PRODUCES_TABLE`、`TABLE_DATA_FLOW`、`SQL_TABLE_JOIN`、`TABLE_TO_COLUMN_LINEAGE`、`COLUMN_TO_COLUMN_LINEAGE`。每个实体还必须携带严格的语义对象：

```json
{
  "schema": "snw.sql_lineage_event.v3",
  "title": "订单事实表加工",
  "summary": "业务订单事实表由临时清洗表加工产生。",
  "content": "dwd.order_fact 由 stage.tmp_order_clean 加工产生。",
  "category": "TABLE_DATA_FLOW",
  "keywords": ["dwd.order_fact"],
  "evidence": {
    "repositoryId": "repo:a6dbcb788f1f3c005ea530746b0a5284a47ac58d80708069d513fe9b2a6d7a74",
    "fileId": "file:784e08beaddb63bdc7eb4645b606d7905aa433c09c2866bf016de023ac60d8f1",
    "statementId": "stmt:ab69c3d8a06de2b730ea02fb99b7f17eefcf94f7eedf615333491296e0cc7344",
    "relativePath": "daily/build_order_fact.sql",
    "contentHash": "85b0c0ed18ca5c6e04953db3b8b0f48e943379857c686726baa2bfd6a403829c",
    "gitCommit": null,
    "dialect": "maxcompute",
    "parserVersion": "0.1.0",
    "span": {
      "startByte": 0,
      "endByte": 168,
      "startLine": 1,
      "startColumn": 1,
      "endLine": 7,
      "endColumn": 2
    }
  },
  "entities": [
    {
      "type": "task",
      "name": "build_order_fact",
      "description": "订单事实表加工任务",
      "semantics": { "role": "business" }
    },
    {
      "type": "table",
      "name": "dwd.order_fact",
      "description": "订单事实表",
      "semantics": { "role": "business" }
    },
    {
      "type": "table",
      "name": "stage.tmp_order_clean",
      "description": "清洗中间表",
      "semantics": { "role": "temporary" }
    }
  ],
  "relations": [
    {
      "source": { "type": "table", "name": "stage.tmp_order_clean" },
      "type": "DATA_FLOW",
      "target": { "type": "table", "name": "dwd.order_fact" },
      "contextTask": "build_order_fact"
    }
  ]
}
```

`semantics.role` 仅允许：

- `business`：允许进入 answer graph、业务答案和默认画布。
- `temporary`：完整保留在 evidence graph，只通过证据路径和检查器按需披露。
- `evidence_only`：用于上下文、佐证或路径闭包，不作为业务答案端点。

当前配套的 `snw-sag-sql-lineage` 生产方只输出 task=`business`、persistent table/column=`business`、temporary table/column=`temporary`。`evidence_only` 为其他显式 v3 生产方和后续节点类型保留；SAG 可以消费但绝不自行推断。关系端点和 `contextTask` 必须引用同一事件 `entities` 中已声明且类型匹配的实体。

摄取时将其合并写入实体已有 JSONB：

```json
{
  "lineageSemantics": {
    "role": "temporary",
    "sourceSchema": "snw.sql_lineage_event.v3"
  }
}
```

事件级 `evidence` 使用严格对象校验，字段固定为 `repositoryId`、`fileId`、`statementId`、`relativePath`、`contentHash`、可空 `gitCommit`、`dialect`、`parserVersion` 和 `span`，未知字段一律拒绝。三个 ID 分别为对应前缀加 64 位小写 SHA-256 十六进制；`contentHash` 是不带 `sha256:` 前缀的 64 位小写十六进制；`gitCommit` 非空时为 40 或 64 位小写十六进制。`relativePath` 必须是无 `..` 的 POSIX 仓库相对路径。`span.startByte` 含、`span.endByte` 不含，行列均为 1-based；content hash 只在 evidence 顶层出现。全部锚点来自上游 SQLGlot/SQLite 事实源，并合并写入 `events.metadata.sqlLineageEvidence`。绝对源码路径不得进入 v3 信封。SAG 只保存和回传这些锚点，不据此重新解析 SQL 或修改事实。

合并只更新 `metadata.lineageSemantics`，不得覆盖实体其他 metadata。相同 `source_id + type + normalized_name` 首次收到 v3 时可以补齐语义；后续 v3 声明必须一致，冲突时整次摄取失败并回滚。v1/v2 继续按原契约解析，不写入也不清除 `lineageSemantics`；缺少该字段的历史实体按 `business` 兼容显示。由此，严格 answer-safe 保证适用于显式产出 v3 的数据，旧数据不因名称猜测发生静默重分类。

### 2. Evidence graph 与 answer graph

双图不是两份持久化数据。`lineage_relations` 和全部实体始终构成唯一 evidence graph；answer graph 是服务端基于实体 metadata 生成的确定性只读投影：

```text
v1/v2/v3 信封
    -> 严格解析与事务写入
    -> evidence graph（完整事实）
    -> answer projector（按显式 semantics 投影）
    -> HTTP / MCP / Web answer graph
                       -> evidence path 详情 -> 检查器
```

投影规则如下：

1. `business` 或兼容期无语义实体是可见端点；`temporary` 和 `evidence_only` 是隐藏端点。
2. 可见实体之间的直接关系原样保留。
3. 两个可见实体之间经过一个或多个隐藏实体的最大有向路径收敛为 answer edge，并生成一个或多个 `evidencePathSummaries`。
4. 只有一个可见端点的路径生成附着于该端点的证据胶囊；没有可见端点的隐藏连通分量不进入 answer graph，但仍可在 evidence graph 中按权限查询。
5. 路径遍历按边 ID 去重并显式处理环；`pathId` 由投影版本、可见端点和有序边 ID 计算，确保相同 evidence graph 得到稳定结果。

answer graph 返回的 `evidencePathSummaries` 不包含隐藏实体名称：

```ts
interface EvidencePathSummary {
  pathId: string;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  hiddenNodeCount: number;
  relationTypes: string[];
  evidenceCount: number;
  eventIds: string[];
}
```

完整路径由专用详情查询按 `pathId` 返回有序节点、边、事件和语义角色，供检查器虚拟化展示。主 answer graph 响应只携带摘要，因此不会因保留证据而把临时名称重新暴露到默认画布或答案上下文。

SAG 生成的 `pathId` 使用 `sagpath:` 前缀，只在当前租户、项目和已摄取图 revision 内有效。它不是 v3 事件字段，也不能传给 SQL lineage 的 `get_lineage_evidence_path`。SQL lineage 会生成独立的 `sqlpath:`；两个服务的 `evidencePathSummaries` 是各自接口 DTO，不共享 pathId、字段全集或详情 wire contract，详情必须向签发 ID 的服务请求。一次 answer projector、canonical fact、validator 和 renderer 调用必须固定在同一 graph revision；处理中 revision 改变时取消并重试，无法重试则 fail closed。SAG 本轮不实时回调 SQLite，只保证答案与当前已摄取 v3 evidence revision 一致；源码新鲜度与权威 raw 查询由 SQL lineage 的 `status`/raw 工具承担。

HTTP 血缘接口增加 `view=answer|evidence`，默认 `answer`；evidence path 使用项目级详情接口并继续校验租户、项目、归档和删除状态。MCP 新增答案型 `sag_trace_lineage`，默认使用 answer 投影并返回 `evidencePathSummaries`；完整链只能通过显式 `sag_get_lineage_evidence_path` 获取。通用 `sag_search` 保持证据检索语义和既有 section/trace 返回，不被改造成血缘答案接口。

### 3. 服务端 canonical fact 选择与确定性渲染

搜索或 MCP 智能体先获得 answer graph。服务端根据当前查询方向和 answer relation 生成只读 `CanonicalLineageAnswerFact`；端点、关系与 provenance 在生成时闭合绑定：

```ts
interface CanonicalLineageAnswerFact {
  answerFactId: string;
  graphRevision: string;
  claimType: "upstream" | "downstream" | "produces" | "joins" | "derived_from";
  sourceBusinessEntityId: string | null;
  targetBusinessEntityId: string | null;
  answerRelationId: string | null;
  evidencePathIds: string[];
  eventIds: string[];
  evidenceCount: number;
}

interface LineageAnswerSelection {
  answerFactIds: string[];
}
```

LLM 只能从已提供 fact 中选择 `answerFactId`，不得提交自由正文、端点、关系、证据引用，或名称、描述、别名、SQL、表达式、加工步骤等字符串。共享 validator/renderer 在 HTTP/MCP 输出前执行以下确定性处理：

1. selection 必须通过拒绝未知字段的严格 schema；每个 fact ID 必须属于当前租户、项目、查询上下文和 graph revision。
2. 服务端按 fact ID 读取 canonical 端点、answer relation、方向、pathIds、eventIds 和 evidenceCount；客户端或模型没有覆盖 provenance 的入口，因此不能拼接“已授权但不相关”的路径或事件。
3. 服务端只用 canonical fact、业务实体 `displayName`、公开关系标签、方向和证据数量通过固定中英文模板渲染最终答案。实体 description、alias、原始事件 summary/content 和 EvidencePathDetail 均不进入渲染输入。
4. 渲染后再以显式标记为 `temporary`/`evidence_only` 的实体名称与 alias 做防御性扫描；该词表来自 metadata，不根据名称模式推断角色。
5. 校验失败时丢弃整个 selection。服务端可以携带结构化违规原因重试一次；再次失败则返回固定安全失败响应和可用业务实体/证据数量，不返回模型生成文本。

提示词只能帮助模型选择 fact，不属于安全边界。Web 对话、HTTP 答案接口和 MCP 会话必须调用同一个 validator 与 renderer，避免某个出口绕过。验证前不存在可发送的候选正文；验证通过后只发送服务端渲染文本，模型 token 永不得直接流式发送给客户端。显式 evidence-path 详情仅用于检查器和证据工具，不能成为 answer renderer 的输入。

### 4. 默认 Web 答案图与证据检查器

Web 进入类型化血缘页时请求 `view=answer`。任务、表和字段只为 answer graph 的业务实体创建节点。每条投影路径显示为连接业务端点的证据胶囊，文案仅包含“证据路径数量、隐藏步骤数、证据数”，不显示临时实体名称；单端路径胶囊附着在对应业务节点。

点击胶囊后，右侧检查器请求完整 evidence path，并以有序步骤展示隐藏任务、表、字段、关系类型和事件证据。关闭检查器后，完整中间链从 UI 状态移除，但已加载详情可保留在受项目 ID 隔离的内存缓存中。自然语言答案和主画布均不渲染完整链。

检查器统计明确区分：

- evidence 已加载实体/关系数；
- answer graph 业务实体/关系数；
- 当前画布在筛选、折叠和证据束处理后的节点/边数；
- 被语义投影、用户折叠和几何冲突分别收起的数量。

### 5. 独立折叠与缓存边界

任务和表节点维护 `upstream`、`downstream` 两个独立折叠状态。折叠某个方向时，从该节点出发沿对应方向隐藏当前 answer graph 中的可达分支，并用边界胶囊显示隐藏节点和关系数量；共享节点只要仍由其他未折叠路径可达，就继续显示。再次展开直接从内存中的 answer graph 恢复，不重新摄取，也不删除已加载 evidence graph 或 traversal cache。

表卡片字段使用独立 `fieldsExpanded` 状态，不与上游/下游折叠复用。选中的字段始终可见；字段收起只改变表卡片行和字段端口，不改变底层字段关系。每次折叠状态变化都会重新生成端口、布局和几何审计结果。

### 6. 端口感知 ELK 与自定义正交边

继续使用 ELK layered `RIGHT` 布局和 React Flow 节点。画布模型为任务/表主端口及每个可见字段行生成稳定 port ID，ELK children 携带端口尺寸、侧边和固定顺序约束；边直接连接 port ID。启用固定端口顺序、layer sweep 交叉最小化、节点与边间距和正交路由。

布局适配器同时保留：

- 节点位置和尺寸；
- ELK edge sections 的 start point、bend points、end point；
- 每条边对应的源/目标 port；
- 布局降级和几何审计信息。

React Flow 注册自定义正交 edge，按 edge sections 绘制 SVG 路径，不再用内置 `smoothstep` 重算。自动布局节点默认 `draggable=false`；平移和缩放继续可用。若未来允许手动布局，必须作为独立模式重新路由并重新审计，不得复用当前自动布局承诺。

### 7. 几何审计与非平面降级

布局后在画布坐标系执行确定性几何审计。所有坐标比较使用固定 `epsilon=0.5` CSS px；距离小于或等于 epsilon 视为接触：

- 任意两个顶层节点矩形不得相交，并满足配置的最小间距。
- 边段除自身声明的源/目标端口外不得进入或接触任何节点边界；在非所属节点边界接触也计为边穿节点。
- 不同语义边不得存在未声明的共线重叠段。
- 边段只允许在双方共同声明的同一端口相交；其他交点计为非端点交叉。

可平面化主图的四项计数必须全部为 0。若完整 answer graph 非平面或 ELK 结果仍有冲突，系统按以下稳定优先级保留主画布边：当前选中路径优先；同级时直接业务关系优先于投影关系；再按 `evidenceCount` 降序；最后按稳定 edge ID 字典序升序。造成冲突的较低优先级关系收进相邻业务端点的证据束和检查器，然后重新布局并复审。所有被收起的关系仍保留在 answer graph/evidence graph 数据和检查器统计中。

如果节点布局本身无法通过审计，画布保留无重叠节点和证据胶囊，冲突关系全部进入检查器，并显示明确的降级状态；不得绘制已知穿节点或交叉线。

### 8. 筛选、穿透和响应式口径

遍历加载器接收已经应用实体类型、关系类型和 answer/evidence 视图的图及允许边谓词。隐藏实体和隐藏关系既不进入 BFS frontier，也不消耗 40 次请求预算和 500 节点预算；切换筛选或项目会取消旧请求。evidence path 详情加载使用独立预算，不污染 answer graph 穿透状态。

工作台依据自身容器宽度而不是只看浏览器 viewport 决定布局。在 1280 和 1440 桌面视口，即使项目侧栏保持展开，选中检查器也使用预留 grid/flex 列，不使用覆盖中央画布的 absolute 面板；紧凑三栏宽度为左控制区、`minmax(480px, 1fr)` 画布和右检查器。自动验收必须分别断言中央画布宽度不小于 480 px，且检查器与画布 bounding box 的交集面积为 0。容器不足时左右面板才转为可关闭抽屉，抽屉必须完全位于视口内，关闭后恢复画布平移、缩放和节点选择。

### 9. 自动化验证

单元测试使用链、菱形、扇入、扇出、多字段端口、平行边、环和 `K3,3` fixture，直接断言投影结果、折叠可逆性、路由端口和几何审计计数。答案测试覆盖 canonical fact provenance、合法 selection、自由正文与语义改写字段、已授权但错配的 relation/event/path 引用、外部或旧 revision factId、revision 中途变化、重试失败和安全失败响应。

Playwright 使用仓库内确定性 fixture 或 Mock API，不依赖固定项目 UUID。CI 安装 Chromium，并至少覆盖 390、768、1280、1440、1720 五种视口；断言证据胶囊、检查器完整链、折叠恢复、筛选预算、面板边界、节点文本、端口箭头和几何审计结果。

## 风险 / 权衡

- v1/v2 没有显式语义，兼容策略会把无 metadata 的历史实体继续作为业务实体展示；要获得严格 answer-safe 结果，生产方必须升级到 v3，而 SAG 不会以名称猜测弥补缺失语义。
- 非平面关系收进证据束意味着默认主画布不再同时画出所有业务关系，但关系不会丢失，检查器和 evidence graph 仍完整可查。
- evidence path 可能很长；默认响应只返回摘要，检查器按 `pathId` 获取完整链并使用虚拟列表，避免主图响应和 DOM 失控。
- canonical fact 选择与服务端渲染会限制自由叙述能力，并可能触发一次结构化重试；安全失败优先于让模型改写或泄漏中间链事实，完整加工过程仍可在证据检查器查看。
- 禁止自动布局节点自由拖动减少了手工调整自由度，但能保持端口、零重叠和几何审计承诺。

## 兼容与迁移

1. 数据库无需新增列；部署后继续读取已有 `entities.metadata`。
2. v1/v2 输入、普通文档抽取和普通事件-实体图保持现有行为。
3. v3 生产方上线后，新摄取实体获得显式语义；对历史实体的首个一致 v3 声明可以补齐 metadata。
4. 类型化血缘 HTTP/Web/MCP 默认视图切换为 `answer`，需要完整事实的显式调用使用 `view=evidence` 或 evidence path 详情接口。
5. 回滚 UI 时 evidence graph 与 v3 metadata 仍可被旧版本作为普通 JSONB 忽略，不破坏既有关系读取。
