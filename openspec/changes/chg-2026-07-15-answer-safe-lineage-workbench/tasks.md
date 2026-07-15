# Tasks: Answer-safe 血缘工作台

## 1. v3 契约与语义持久化

- [ ] 1.1 在 `test/extractor.test.ts` 先添加 v3 五类 category、有效语义与冻结 evidence wire、哈希 ID、相对路径、可空 Git commit、未知字段、非法 role、非法 SourceSpan、关系端点与 contextTask 闭包、v1/v2 兼容和禁止名称猜测的失败测试，再扩展 `src/types.ts` 与 `src/ingestion/extract/structured-event.ts`。
- [ ] 1.2 在 ingestion/repository 测试中覆盖 `entities.metadata.lineageSemantics`、`events.metadata.sqlLineageEvidence` 合并、旧 metadata 保留、v1/v2 不清除语义、首次 v3 补齐和冲突 v3 整体回滚，再修改 `src/services/ingestion-service.ts` 与 `src/db/repositories.ts`。
- [ ] 1.3 运行结构化事件和摄取测试，确认非法 v3 不产生部分事件、实体或关系，合法 v1/v2 输出与变更前一致。

## 2. Evidence graph 与 answer graph 投影

- [ ] 2.1 新增纯 answer projector 及链、分支、单端路径、隐藏连通分量、环和多证据 fixture 测试，验证完整 evidence graph 不变、answer graph 隐藏 `temporary`/`evidence_only` 端点并生成稳定 `evidencePathSummaries`。
- [ ] 2.2 扩展共享血缘类型和 repository/service，使 `view=answer|evidence` 默认选择 answer，并实现 `sagpath:` 前缀、租户/项目/图 revision 隔离的 evidence path 详情查询；测试归档、删除、租户越权、`sqlpath:`、过期和不存在 pathId，且 v3 不携带服务内 pathId。answer projection 到 renderer 必须固定同一 revision，测试中途变更时取消重试或 fail closed，且不建立 SQLite 实时回调。
- [ ] 2.3 更新 `src/api/server.ts`、`web/src/lib/api.ts` 和前后端类型，验证 answer 响应不含隐藏实体名称，evidence 响应和 path 详情仍返回完整有序链。

## 3. 服务端答案安全与 MCP

- [ ] 3.1 新增服务端 `CanonicalLineageAnswerFact` 生成器、严格 `LineageAnswerSelection` schema、共享 validator 与确定性 renderer 单元测试，覆盖合法 fact、拒绝自由正文/未知字段、拒绝隐藏名称及无原名的描述/SQL/加工步骤改写、拒绝外部或旧 revision factId，以及拒绝模型拼接已授权但不属于该 fact 的 relation/event/path 引用。
- [ ] 3.2 在答案编排服务中接入 answer projector、canonical fact、selection validator 与固定模板 renderer，确保端点、关系和 provenance 由服务端闭合绑定，只使用业务 displayName、公开关系标签、方向和证据数量生成答案；隐藏 metadata、原始事件文本与完整路径不进入 renderer，模型 token 永不直接流式发送，并覆盖一次结构化重试和固定安全失败响应；通用 `sag_search` 算法与普通文档响应保持不变。
- [ ] 3.3 更新 `src/mcp/server.ts`、`src/services/mcp-agent-service.ts` 与 MCP 设置说明，新增 `sag_trace_lineage` 和 `sag_get_lineage_evidence_path`；答案工具默认返回 answer 投影和 `evidencePathSummaries`，完整路径只能通过显式详情调用获取，并添加 MCP 协议级防泄漏测试。

## 4. Answer graph 工作台与折叠

- [ ] 4.1 扩展 `web/src/lib/lineage-graph-model.ts` 与 canvas model，分别表示 evidence、answer、canvas 三层计数，并将投影路径转换为不含隐藏名称的可点击证据胶囊。
- [ ] 4.2 更新 `LineageGraphFlow.tsx`、语义节点和检查器，使 Web 默认请求 answer graph，主画布只显示业务节点，点击证据胶囊后在检查器展示完整 evidence path。
- [ ] 4.3 为任务/表增加独立上游和下游折叠，为表字段保留独立折叠；添加共享分支、选中字段、缓存不删除、无需重新请求和展开后精确恢复的模型与组件测试。
- [ ] 4.4 修正检查器和状态栏文案，分别展示 evidence 已加载、answer 投影、canvas 可见、语义隐藏、用户折叠和几何证据束数量，避免 `HAS_COLUMN` 等未绘制关系计入可见边。

## 5. 端口感知布局、自定义边与几何审计

- [ ] 5.1 在 `test/lineage-layout.test.ts` 增加字段端口、动态节点高度、扇入扇出、平行边、环和非平面 fixture 的失败测试，断言 ELK 输入包含固定端口且输出保留 edge sections。
- [ ] 5.2 扩展 `web/src/components/lineage-graph/layout.ts`，使用 ELK layered RIGHT、固定端口顺序、layer sweep 和 ORTHOGONAL 路由，返回节点位置、端口和完整折点；保留确定性无重叠降级布局。
- [ ] 5.3 新增自定义 React Flow 正交 edge，按 ELK edge sections 绘制路径和箭头，移除类型化血缘的 `smoothstep`，并将自动布局节点设为不可自由拖动。
- [ ] 5.4 新增纯几何审计器和测试，以固定 0.5 CSS px epsilon 计算节点重叠、边穿节点、未声明共线重叠和非端点交叉；覆盖节点边界接触、共同端口例外和稳定优先级，可平面 fixture 四项为 0，`K3,3` 冲突关系进入证据束后主画布四项为 0。
- [ ] 5.5 在展开、收起、筛选、穿透和证据束变化后统一执行重新布局与审计；审计无法通过时只渲染无重叠节点和证据胶囊，并显示降级原因，不画已知冲突边。

## 6. 筛选遍历、响应式和交互一致性

- [ ] 6.1 修改 traversal loader 契约，使 BFS 接收筛选后的 answer/evidence 图和允许边谓词；测试隐藏实体/关系不进入 frontier、不消耗请求或节点预算，并验证项目/筛选切换取消迟到响应。
- [ ] 6.2 将工作台改为基于容器宽度的三栏布局；在项目侧栏展开的 1280/1440 视口为检查器预留列，自动断言画布宽度至少 480 px 且与检查器 bounding box 交集面积为 0，空间不足时才使用可关闭抽屉。
- [ ] 6.3 验证搜索、1-5 层穿透、复位、聚焦、关系详情、证据胶囊、字段折叠和方向折叠共享一致的选中与统计状态。

## 7. Playwright fixture、CI 与交付验证

- [ ] 7.1 建立仓库内确定性 answer/evidence graph fixture 和 Mock API 浏览器入口，覆盖业务实体、临时路径、字段端口、共享分支、非平面冲突和超预算遍历，不依赖固定数据库项目 UUID。
- [ ] 7.2 将现有视觉脚本迁移为可在 Linux CI 执行的 Playwright 验收，覆盖 390、768、1280、1440、1720 视口，并断言证据胶囊、完整检查器链、折叠恢复、面板不覆盖、无页面溢出和几何审计计数。
- [ ] 7.3 更新 `.github/workflows/ci.yml` 安装 Chromium 并执行浏览器验收；失败时上传截图、DOM 快照、answer/evidence fixture 和几何审计 JSON。
- [ ] 7.4 更新中英文 README 与项目设计说明，明确 v3 语义、默认 answer graph、显式 evidence 查询、服务端答案校验和折叠/无交叉边界。
- [ ] 7.5 依次运行 `npm test`、`npm run typecheck`、`npm run build`、`node scripts/openspec-ci-check.mjs` 和 Playwright fixture 验收，要求全部通过且不引入新图引擎依赖。
