# Answer-safe 血缘工作台交互实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将现有类型化血缘页升级为只展示 answer graph 的可审计工作台，支持证据胶囊、独立方向/字段折叠、端口感知正交路由、确定性几何降级和 Linux CI Playwright 验收。

**架构：** 保留 React Flow + ELK，把后端 answer/evidence DTO、纯画布投影、折叠、布局、几何审计和 React 渲染分层。所有交互先更新纯模型，再重新布局并审计；只有通过审计的正交边进入 React Flow，冲突关系进入证据束和检查器。

**技术栈：** React 19、TypeScript 5.7、@xyflow/react 12、elkjs 0.11、Vitest 4、Playwright、Vite 8、Tailwind CSS 3。

---

## 实施边界与服务端前置契约

- 本计划只修改 Web、Web 纯模型、浏览器 fixture、测试、CI 和相关说明，不实现 repository、answer projector、canonical fact 或服务端 validator。
- Web 默认调用 `GET /api/projects/:projectId/lineage-graph?view=answer`；节点展开和搜索继续使用同一路由并携带 `view=answer`。
- 证据详情调用 `GET /api/projects/:projectId/lineage-evidence-paths/:pathId`，服务端负责租户、项目、归档、删除和 graph revision 校验。
- `LineageGraphRecord` 必须携带 `view`、`graphRevision`、`stats` 和 `evidencePathSummaries`；Web 不从实体名称推断 `business`、`temporary` 或 `evidence_only`。
- 工作区当前没有 `.codegraph/`，实现时使用下列精确路径和 Vitest/Playwright 定位，不做跨项目重构。

## 文件结构

### 创建

- `web/src/components/lineage-graph/answer-view-model.ts`：把 answer DTO 转为业务节点、投影关系、证据胶囊和分层统计。
- `web/src/components/lineage-graph/collapse-model.ts`：方向折叠、共享节点保留、边界胶囊和可逆状态。
- `web/src/components/lineage-graph/geometry-audit.ts`：`epsilon=0.5` 的纯几何判定与审计报告。
- `web/src/components/lineage-graph/audited-layout.ts`：ELK 结果审计、稳定优先级和非平面关系证据束降级。
- `web/src/components/lineage-graph/OrthogonalLineageEdge.tsx`：原样绘制 ELK edge sections 的 React Flow 自定义边。
- `web/src/components/lineage-graph/LineageEvidenceInspector.tsx`：证据路径加载、固定行高虚拟列表和错误/空状态。
- `web/src/components/lineage-graph/workbench-layout.ts`：基于容器宽度选择三栏或抽屉。
- `web/src/components/lineage-graph/evidence-path-cache.ts`：按项目、revision、pathId 隔离详情缓存。
- `web/src/fixtures/lineage-workbench-fixture.ts`：单元测试和浏览器共用的确定性 answer/evidence fixture。
- `web/src/lineage-fixture-main.tsx`、`web/lineage-fixture.html`：不连接数据库的浏览器验收入口。
- `test/lineage-answer-view-model.test.ts`、`test/lineage-collapse-model.test.ts`、`test/lineage-geometry-audit.test.ts`、`test/lineage-workbench-layout.test.ts`：新增纯模型测试。
- `test/e2e/lineage-workbench.spec.ts`、`playwright.config.ts`：五档视口浏览器验收。

### 修改

- `web/src/types.ts`、`web/src/lib/api.ts`、`web/src/App.tsx`：answer/evidence DTO、默认 answer 查询和详情加载。
- `web/src/lib/lineage-graph-model.ts`：筛选后邻域与加载图合并口径。
- `web/src/components/lineage-graph/canvas-model.ts`：稳定端口、胶囊节点、字段展开和 canvas 统计。
- `web/src/components/lineage-graph/layout.ts`：ELK port 输入和 edge sections 输出。
- `web/src/components/lineage-graph/traversal-loader.ts`：筛选后 frontier、可见预算和 AbortSignal。
- `web/src/components/lineage-graph/LineageCanvasNodes.tsx`：方向/字段折叠按钮、字段端口和胶囊节点。
- `web/src/components/lineage-graph/LineageWorkbenchPanels.tsx`：明确统计口径和当前/总关系数。
- `web/src/components/LineageGraphFlow.tsx`：编排纯模型、缓存、布局、审计、三栏和抽屉。
- `test/lineage-canvas-model.test.ts`、`test/lineage-layout.test.ts`、`test/lineage-traversal-loader.test.ts`：扩展现有测试。
- `vite.config.ts`、`package.json`、`package-lock.json`、`.github/workflows/ci.yml`：fixture 多入口、Playwright 和 CI。
- `README.md`、`README-CN.md`、`DESIGN.md`：记录 answer/evidence 与交互边界。

### 删除

- `scripts/verify-lineage-ui.mjs`：迁移到仓库 fixture 驱动的 Playwright 测试，移除固定 UUID 和 macOS Chrome 路径。

## 任务 1：锁定 Web answer/evidence DTO 与确定性 fixture

**文件：**
- 修改：`web/src/types.ts:155-181`
- 修改：`web/src/lib/api.ts:100-115`
- 创建：`web/src/fixtures/lineage-workbench-fixture.ts`
- 创建：`test/lineage-answer-view-model.test.ts`

- [ ] **步骤 1：先写 DTO fixture 的失败测试**

```ts
import { describe, expect, it } from "vitest";
import { ANSWER_GRAPH_FIXTURE, EVIDENCE_PATH_FIXTURE } from "../web/src/fixtures/lineage-workbench-fixture.js";

describe("lineage answer DTO fixture", () => {
  it("keeps hidden names out of the answer graph", () => {
    expect(ANSWER_GRAPH_FIXTURE.view).toBe("answer");
    expect(JSON.stringify(ANSWER_GRAPH_FIXTURE)).not.toContain("stage.tmp_order_clean");
    expect(ANSWER_GRAPH_FIXTURE.evidencePathSummaries[0]).toEqual(expect.objectContaining({
      pathId: "sagpath:orders-to-mart",
      hiddenNodeCount: 2,
      evidenceCount: 3
    }));
    expect(EVIDENCE_PATH_FIXTURE.nodes.map((node) => node.name)).toContain("stage.tmp_order_clean");
  });
});
```

- [ ] **步骤 2：运行测试并确认红灯**

运行：`npx vitest run test/lineage-answer-view-model.test.ts`

预期：FAIL，报错 `Cannot find module '../web/src/fixtures/lineage-workbench-fixture.js'`。

- [ ] **步骤 3：加入严格 Web DTO**

在 `web/src/types.ts` 定义并让 `LineageGraphRecord` 引用以下字段；不要保留另一套同义字段名：

```ts
export type LineageGraphView = "answer" | "evidence";
export type LineageSemanticRole = "business" | "temporary" | "evidence_only";

export interface EvidencePathSummary {
  pathId: string;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  hiddenNodeCount: number;
  relationTypes: string[];
  evidenceCount: number;
  eventIds: string[];
}

export interface LineageGraphStats {
  evidenceLoadedNodes: number;
  evidenceLoadedEdges: number;
  answerNodes: number;
  answerEdges: number;
  semanticHiddenNodes: number;
  semanticHiddenEdges: number;
}

export interface LineageEvidencePathDetail {
  pathId: string;
  graphRevision: string;
  nodes: Array<LineageGraphNodeRecord & { role: LineageSemanticRole; order: number }>;
  edges: Array<LineageGraphEdgeRecord & { order: number; eventIds: string[] }>;
  events: Array<{ id: string; title: string; summary: string; relativePath: string; statementId: string }>;
}

export interface LineageGraphRecord {
  available: boolean;
  view: LineageGraphView;
  graphRevision: string;
  nodes: LineageGraphNodeRecord[];
  edges: LineageGraphEdgeRecord[];
  evidencePathSummaries: EvidencePathSummary[];
  stats: LineageGraphStats;
  hasMore: boolean;
}
```

- [ ] **步骤 4：建立固定 fixture**

在 `web/src/fixtures/lineage-workbench-fixture.ts` 固定业务链 `orders -> order_fact -> order_mart`、两个隐藏步骤、共享下游、字段端口、平行边、环和 `K3,3` 九条关系；导出 `ANSWER_GRAPH_FIXTURE`、`EVIDENCE_PATH_FIXTURE`、`COLLAPSE_GRAPH_FIXTURE`、`TABLE_ONLY_FILTERS`、`TRAVERSAL_PAGES`。answer 常量中只允许业务名称，隐藏名称只存在于 detail 常量。

- [ ] **步骤 5：让 API 默认请求 answer 并支持详情取消**

```ts
async getLineageGraph(projectId: string, input: {
  view?: LineageGraphView;
  nodeId?: string;
  query?: string;
  limit?: number;
  signal?: AbortSignal;
} = {}) {
  const params = new URLSearchParams({ view: input.view ?? "answer" });
  if (input.nodeId) params.set("nodeId", input.nodeId);
  if (input.query) params.set("query", input.query);
  if (input.limit) params.set("limit", String(input.limit));
  return request<{ graph: LineageGraphRecord }>(
    `/api/projects/${projectId}/lineage-graph?${params.toString()}`,
    { signal: input.signal }
  );
},

async getLineageEvidencePath(projectId: string, pathId: string, signal?: AbortSignal) {
  return request<{ path: LineageEvidencePathDetail }>(
    `/api/projects/${projectId}/lineage-evidence-paths/${encodeURIComponent(pathId)}`,
    { signal }
  );
}
```

- [ ] **步骤 6：运行测试和类型检查并确认绿灯**

运行：`npx vitest run test/lineage-answer-view-model.test.ts`

预期：PASS，1 个测试通过。

运行：`npm run typecheck`

预期：PASS，无 TypeScript 错误。

- [ ] **步骤 7：提交 DTO 与 fixture**

```bash
git add web/src/types.ts web/src/lib/api.ts web/src/fixtures/lineage-workbench-fixture.ts test/lineage-answer-view-model.test.ts
git commit -m "test(图谱): 固定答案与证据工作台契约"
```

## 任务 2：生成证据胶囊、分层统计和详情缓存

**文件：**
- 创建：`web/src/components/lineage-graph/answer-view-model.ts`
- 创建：`web/src/components/lineage-graph/evidence-path-cache.ts`
- 修改：`test/lineage-answer-view-model.test.ts`

- [ ] **步骤 1：写证据胶囊和统计失败测试**

```ts
it("creates safe capsules and keeps metric layers separate", () => {
  const model = buildAnswerViewModel(ANSWER_GRAPH_FIXTURE);
  expect(model.capsules).toEqual([expect.objectContaining({
    id: "evidence:sagpath:orders-to-mart",
    label: "2 个隐藏步骤 · 3 条证据"
  })]);
  expect(model.metrics).toEqual(expect.objectContaining({
    evidenceLoadedNodes: 8,
    answerNodes: 6,
    semanticHiddenNodes: 2
  }));
  expect(JSON.stringify(model.capsules)).not.toContain("tmp_order_clean");
});
```

- [ ] **步骤 2：运行测试并确认红灯**

运行：`npx vitest run test/lineage-answer-view-model.test.ts`

预期：FAIL，报错 `buildAnswerViewModel is not defined`。

- [ ] **步骤 3：实现安全视图模型**

```ts
export interface EvidenceCapsuleModel {
  id: string;
  pathId: string;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  label: string;
  hiddenNodeCount: number;
  evidenceCount: number;
}

export interface LineageAnswerViewModel {
  graph: LineageGraphRecord;
  capsules: EvidenceCapsuleModel[];
  metrics: LineageGraphStats;
}

export function buildAnswerViewModel(graph: LineageGraphRecord): LineageAnswerViewModel {
  if (graph.view !== "answer") throw new Error("Lineage workbench requires view=answer");
  return {
    graph,
    capsules: graph.evidencePathSummaries.map((path) => ({
      id: `evidence:${path.pathId}`,
      pathId: path.pathId,
      sourceNodeId: path.sourceNodeId,
      targetNodeId: path.targetNodeId,
      label: `${path.hiddenNodeCount} 个隐藏步骤 · ${path.evidenceCount} 条证据`,
      hiddenNodeCount: path.hiddenNodeCount,
      evidenceCount: path.evidenceCount
    })),
    metrics: { ...graph.stats }
  };
}
```

- [ ] **步骤 4：实现项目/revision/path 隔离缓存并测试**

缓存 key 固定为 `${projectId}:${graphRevision}:${pathId}`；`clearProject(projectId)` 只删除该项目前缀，项目或 revision 改变时不得复用旧详情。

```ts
const cache = new EvidencePathCache();
cache.set("project-a", "rev-1", EVIDENCE_PATH_FIXTURE);
expect(cache.get("project-a", "rev-1", EVIDENCE_PATH_FIXTURE.pathId)).toBe(EVIDENCE_PATH_FIXTURE);
expect(cache.get("project-a", "rev-2", EVIDENCE_PATH_FIXTURE.pathId)).toBeUndefined();
expect(cache.get("project-b", "rev-1", EVIDENCE_PATH_FIXTURE.pathId)).toBeUndefined();
```

- [ ] **步骤 5：运行聚焦测试并确认绿灯**

运行：`npx vitest run test/lineage-answer-view-model.test.ts`

预期：PASS，胶囊、隐藏名称和缓存隔离断言全部通过。

- [ ] **步骤 6：提交视图模型**

```bash
git add web/src/components/lineage-graph/answer-view-model.ts web/src/components/lineage-graph/evidence-path-cache.ts test/lineage-answer-view-model.test.ts
git commit -m "feat(图谱): 增加安全证据胶囊模型"
```

## 任务 3：实现独立方向折叠和字段折叠

**文件：**
- 创建：`web/src/components/lineage-graph/collapse-model.ts`
- 创建：`test/lineage-collapse-model.test.ts`
- 修改：`web/src/components/lineage-graph/canvas-model.ts:28-301`
- 修改：`test/lineage-canvas-model.test.ts`

- [ ] **步骤 1：写方向独立、共享节点和可逆性失败测试**

```ts
it("collapses only upstream and restores the exact graph", () => {
  const state = toggleDirection(emptyCollapseState(), "table-b", "upstream");
  const collapsed = projectCollapsedGraph(COLLAPSE_GRAPH_FIXTURE, state);
  expect(collapsed.visibleNodeIds).not.toContain("table-a");
  expect(collapsed.visibleNodeIds).toContain("table-c");
  expect(collapsed.boundaryCapsules).toEqual([
    expect.objectContaining({ anchorNodeId: "table-b", direction: "upstream" })
  ]);

  const restored = projectCollapsedGraph(
    COLLAPSE_GRAPH_FIXTURE,
    toggleDirection(state, "table-b", "upstream")
  );
  expect(restored.visibleNodeIds).toEqual(COLLAPSE_GRAPH_FIXTURE.nodes.map((node) => node.id));
  expect(restored.visibleEdgeIds).toEqual(COLLAPSE_GRAPH_FIXTURE.edges.map((edge) => edge.id));
});

it("keeps a shared node reachable from an uncollapsed branch", () => {
  const projected = projectCollapsedGraph(
    COLLAPSE_GRAPH_FIXTURE,
    toggleDirection(emptyCollapseState(), "table-b", "downstream")
  );
  expect(projected.visibleNodeIds).toContain("shared-dimension");
});
```

- [ ] **步骤 2：运行测试并确认红灯**

运行：`npx vitest run test/lineage-collapse-model.test.ts`

预期：FAIL，报错无法解析 `collapse-model.js`。

- [ ] **步骤 3：实现不可变折叠状态与纯投影**

```ts
export type CollapseDirection = "upstream" | "downstream";
export interface NodeCollapseState { upstream: boolean; downstream: boolean }
export type LineageCollapseState = ReadonlyMap<string, NodeCollapseState>;

export function emptyCollapseState(): LineageCollapseState {
  return new Map<string, NodeCollapseState>();
}

export function toggleDirection(
  state: LineageCollapseState,
  nodeId: string,
  direction: CollapseDirection
): LineageCollapseState {
  const next = new Map(state);
  const current = next.get(nodeId) ?? { upstream: false, downstream: false };
  next.set(nodeId, { ...current, [direction]: !current[direction] });
  return next;
}
```

`projectCollapsedGraph` 按有向边遍历每个折叠锚点；先收集候选分支，再保留仍可由未折叠边从其他业务根到达的共享节点。输出稳定排序的 `visibleNodeIds`、`visibleEdgeIds` 和包含隐藏节点/边数量的 `boundaryCapsules`，不得修改输入 graph。

- [ ] **步骤 4：为字段状态补红灯测试**

在 `test/lineage-canvas-model.test.ts` 增加：字段收起后表高度降低、字段端口回到主端口、选中字段仍可见、原始 `HAS_COLUMN` 与字段血缘数组未改变。

- [ ] **步骤 5：把 `expandedTableIds` 明确重命名为 `fieldsExpandedTableIds`**

修改 `LineageCanvasModelOptions`、`chooseVisibleColumns` 和调用方；字段收起只影响 `columns`、`height`、`sourceHandle`、`targetHandle`，不改 answer graph。方向折叠状态只传给 `projectCollapsedGraph`，不得复用字段 Set。

- [ ] **步骤 6：运行两个测试文件并确认绿灯**

运行：`npx vitest run test/lineage-collapse-model.test.ts test/lineage-canvas-model.test.ts`

预期：PASS，共享节点、精确恢复和选中字段断言通过。

- [ ] **步骤 7：提交折叠模型**

```bash
git add web/src/components/lineage-graph/collapse-model.ts web/src/components/lineage-graph/canvas-model.ts test/lineage-collapse-model.test.ts test/lineage-canvas-model.test.ts
git commit -m "feat(图谱): 支持方向与字段独立折叠"
```

## 任务 4：让穿透预算只计算筛选后的当前投影

**文件：**
- 修改：`web/src/components/lineage-graph/traversal-loader.ts:6-84`
- 修改：`web/src/lib/lineage-graph-model.ts:84-125`
- 修改：`test/lineage-traversal-loader.test.ts`
- 修改：`web/src/components/LineageGraphFlow.tsx:127-292`

- [ ] **步骤 1：写隐藏字段不进 frontier/预算的失败测试**

```ts
it("does not expand filtered nodes or charge them to the visible budget", async () => {
  const loadNode = vi.fn(async (nodeId: string) => TRAVERSAL_PAGES[nodeId] ?? TRAVERSAL_PAGES.empty);
  const result = await loadLineageTraversal({
    sourceGraph: TRAVERSAL_PAGES.root,
    selectedNodeId: "table-orders",
    depth: 2,
    expandedNodeIds: new Set(),
    maxVisibleNodes: 3,
    maxRequests: 40,
    projectGraph: (graph) => filterLineageGraph(graph, TABLE_ONLY_FILTERS),
    loadNode,
    signal: new AbortController().signal,
    onProgress: () => undefined
  });
  expect(loadNode.mock.calls.flat()).not.toContain("column-order-id");
  expect(result.projectedGraph.nodes.every((node) => node.type !== "column")).toBe(true);
  expect(result.visibleNodeCount).toBeLessThanOrEqual(3);
});
```

- [ ] **步骤 2：写 AbortSignal 迟到响应失败测试**

启动一次 pending `loadNode`，调用 `controller.abort()` 后再 resolve；断言 `cancelled=true`、`sourceGraph` 与调用前相同、`onProgress` 未调用。

- [ ] **步骤 3：运行测试并确认红灯**

运行：`npx vitest run test/lineage-traversal-loader.test.ts`

预期：FAIL，当前函数不接受 `sourceGraph`、`projectGraph` 和 `signal`。

- [ ] **步骤 4：实现双图遍历结果**

```ts
export interface LineageTraversalResult {
  sourceGraph: LineageGraphRecord;
  projectedGraph: LineageGraphRecord;
  expandedNodeIds: Set<string>;
  requestCount: number;
  visibleNodeCount: number;
  truncated: boolean;
  cancelled: boolean;
}
```

每次加载后先把 page 合并进 `sourceGraph`，再调用 `projectGraph(sourceGraph)`；BFS 只读取 `projectedGraph.edges`，`maxVisibleNodes` 只比较 `projectedGraph.nodes.length`。`signal.aborted` 在请求前、请求后、`onProgress` 前各检查一次。

- [ ] **步骤 5：在工作台用 AbortController 替换 runId-only 取消**

项目、`view`、实体筛选或关系筛选改变时 abort 当前 traversal；新遍历创建新 controller。保留 runId 仅用于忽略布局 promise，不再用布尔回调模拟网络取消。

- [ ] **步骤 6：运行测试并确认绿灯**

运行：`npx vitest run test/lineage-traversal-loader.test.ts test/lineage-graph-filtering.test.ts`

预期：PASS，40 次请求、500 可见节点、筛选 frontier 和取消断言通过。

- [ ] **步骤 7：提交筛选预算修复**

```bash
git add web/src/components/lineage-graph/traversal-loader.ts web/src/lib/lineage-graph-model.ts web/src/components/LineageGraphFlow.tsx test/lineage-traversal-loader.test.ts
git commit -m "fix(图谱): 按当前投影计算穿透预算"
```

## 任务 5：保留 ELK 端口和正交 edge sections

**文件：**
- 修改：`web/src/components/lineage-graph/canvas-model.ts`
- 修改：`web/src/components/lineage-graph/layout.ts:1-126`
- 创建：`web/src/components/lineage-graph/OrthogonalLineageEdge.tsx`
- 修改：`test/lineage-layout.test.ts`

- [ ] **步骤 1：写 ELK 端口输入与 sections 输出失败测试**

使用 spy engine 捕获 `ElkNode`，返回一条含 start、两个 bend、end 的 section。断言表字段 port ID 为 `field-source-column-id` / `field-target-column-total`、`portConstraints=FIXED_ORDER`、结果 edge 保留四个点及端口 ID。

```ts
expect(captured.children?.find((node) => node.id === "table-orders")?.ports?.map((port) => port.id)).toContain(
  "field-source-column-id"
);
expect(result.edges[0].sections[0].bendPoints).toEqual([{ x: 320, y: 90 }, { x: 320, y: 180 }]);
```

- [ ] **步骤 2：运行测试并确认红灯**

运行：`npx vitest run test/lineage-layout.test.ts`

预期：FAIL，当前布局结果没有 `edges` 和 `sections`。

- [ ] **步骤 3：让 canvas model 生成稳定端口**

为每个节点输出主端口 `entity-target`、`entity-source`，为每个可见字段输出 west/east 字段端口；字段按显示顺序生成 `order`，端口 ID 必须与 React Flow handle 完全一致。

- [ ] **步骤 4：扩展布局返回类型并保留 ELK 折点**

```ts
export interface RoutedLineageCanvasEdge extends LineageCanvasEdge {
  sections: Array<{
    startPoint: { x: number; y: number };
    bendPoints: Array<{ x: number; y: number }>;
    endPoint: { x: number; y: number };
  }>;
}

export interface LineageLayoutResult {
  nodes: PositionedLineageCanvasNode[];
  edges: RoutedLineageCanvasEdge[];
  degraded: boolean;
  error?: string;
}
```

ELK options固定加入 `elk.portConstraints=FIXED_ORDER`、`elk.layered.crossingMinimization.strategy=LAYER_SWEEP` 和 `elk.edgeRouting=ORTHOGONAL`；edge sources/targets 使用 port ID，不再使用 node ID。

- [ ] **步骤 5：先测试再实现 SVG path 生成器**

测试 `edgeSectionsToPath` 对四点 section 精确返回 `M 100 40 L 320 90 L 320 180 L 500 180`。实现 `OrthogonalLineageEdge` 用 `<BaseEdge path={path}>` 和现有 marker/style，不调用 `getSmoothStepPath`。

- [ ] **步骤 6：运行布局测试并确认绿灯**

运行：`npx vitest run test/lineage-layout.test.ts`

预期：PASS，动态高度、字段端口、扇入扇出、平行边、环和 fallback 全部通过。

- [ ] **步骤 7：提交端口路由**

```bash
git add web/src/components/lineage-graph/canvas-model.ts web/src/components/lineage-graph/layout.ts web/src/components/lineage-graph/OrthogonalLineageEdge.tsx test/lineage-layout.test.ts
git commit -m "feat(图谱): 保留 ELK 正交端口路由"
```

## 任务 6：实现 epsilon 几何审计和稳定非平面降级

**文件：**
- 创建：`web/src/components/lineage-graph/geometry-audit.ts`
- 创建：`web/src/components/lineage-graph/audited-layout.ts`
- 创建：`test/lineage-geometry-audit.test.ts`
- 修改：`web/src/components/lineage-graph/layout.ts`

- [ ] **步骤 1：写四类计数和 epsilon 边界失败测试**

```ts
expect(auditGeometry(FAN_FIXTURE, { epsilon: 0.5 })).toMatchObject({
  nodeOverlaps: 0,
  edgeNodeContacts: 0,
  collinearOverlaps: 0,
  nonEndpointCrossings: 0
});
expect(auditGeometry(EDGE_TOUCHING_NODE_AT_05, { epsilon: 0.5 }).edgeNodeContacts).toBe(1);
expect(auditGeometry(EDGE_CLEAR_BY_0501, { epsilon: 0.5 }).edgeNodeContacts).toBe(0);
expect(auditGeometry(SHARED_DECLARED_PORT, { epsilon: 0.5 }).nonEndpointCrossings).toBe(0);
```

在同一测试文件中使用 `GeometryAuditInput` 明确定义 `FAN_FIXTURE`、`EDGE_TOUCHING_NODE_AT_05`、`EDGE_CLEAR_BY_0501`、`SHARED_DECLARED_PORT` 和 `K3_3_FIXTURE`，坐标使用整数；只有 `0.5`/`0.501` 两个边界 fixture 使用小数。

- [ ] **步骤 2：运行测试并确认红灯**

运行：`npx vitest run test/lineage-geometry-audit.test.ts`

预期：FAIL，模块 `geometry-audit.js` 不存在。

- [ ] **步骤 3：实现纯几何谓词**

统一导出 `GEOMETRY_EPSILON = 0.5`、`pointOnSegment`、`segmentsIntersect`、`collinearOverlapLength`、`segmentTouchesRect` 和 `auditGeometry`。距离 `<= epsilon` 视为接触；只有 edge 自身声明的源/目标端口允许接触所属节点，只有两条 edge 都声明同一 port ID 时允许交点。

- [ ] **步骤 4：写稳定优先级和 K3,3 失败测试**

构造 `selected projected edge`、`direct edge`、不同 evidenceCount 和乱序 ID；断言保留顺序严格为：选中路径、直接业务关系、evidenceCount 降序、edge ID 升序。对 `K3,3` 断言最终四项审计为 0、`bundledEdgeIds.length > 0`、所有原关系仍在 `allRelationIds`。

- [ ] **步骤 5：实现审计布局循环**

`layoutAndAuditLineageCanvas` 每轮调用 ELK 和 `auditGeometry`；有边冲突时只移除冲突集合中最低优先级 edge，加入 `bundledEdgeIds` 后重新布局。节点仍冲突时保留 fallback 无重叠节点和胶囊、把全部业务 edge 收束、设置 `degradedReason="node-layout-conflict"`，不得返回已知冲突 path。

- [ ] **步骤 6：运行几何与布局测试并确认绿灯**

运行：`npx vitest run test/lineage-geometry-audit.test.ts test/lineage-layout.test.ts`

预期：PASS，四类计数、共同端口例外、稳定顺序和 K3,3 降级通过。

- [ ] **步骤 7：提交几何边界**

```bash
git add web/src/components/lineage-graph/geometry-audit.ts web/src/components/lineage-graph/audited-layout.ts web/src/components/lineage-graph/layout.ts test/lineage-geometry-audit.test.ts
git commit -m "feat(图谱): 增加确定性几何审计降级"
```

## 任务 7：接入节点、证据检查器、统计和容器响应式布局

**文件：**
- 创建：`web/src/components/lineage-graph/LineageEvidenceInspector.tsx`
- 创建：`web/src/components/lineage-graph/workbench-layout.ts`
- 创建：`test/lineage-workbench-layout.test.ts`
- 修改：`web/src/components/lineage-graph/LineageCanvasNodes.tsx`
- 修改：`web/src/components/lineage-graph/LineageWorkbenchPanels.tsx`
- 修改：`web/src/components/LineageGraphFlow.tsx`
- 修改：`web/src/App.tsx:396-408,2199-2241`

- [ ] **步骤 1：写容器宽度模式失败测试**

```ts
expect(resolveWorkbenchLayout(978, true)).toEqual({
  mode: "three-column",
  explorerWidth: 190,
  inspectorWidth: 286,
  minimumCanvasWidth: 480
});
expect(resolveWorkbenchLayout(700, true).mode).toBe("drawer");
```

- [ ] **步骤 2：运行测试并确认红灯**

运行：`npx vitest run test/lineage-workbench-layout.test.ts`

预期：FAIL，模块 `workbench-layout.js` 不存在。

- [ ] **步骤 3：实现容器而非 viewport 判定**

`resolveWorkbenchLayout` 在宽度 `>=956` 且检查器打开时返回 `190px minmax(480px,1fr) 286px`；较窄时返回 drawer。`LineageGraphFlow` 使用 `ResizeObserver` 读取 workbench 容器，不读取 `window.innerWidth` 决定栏位。

- [ ] **步骤 4：接入方向/字段按钮和固定节点**

任务/表节点提供 `折叠上游`、`折叠下游` 两个独立 `aria-pressed` 按钮；表字段按钮继续单独控制 `fieldsExpandedTableIds`。React Flow 设置 `nodesDraggable={false}`，每个 node 的 `draggable=false`，保留 pan、zoom、select。

- [ ] **步骤 5：注册正交边并只渲染审计通过关系**

```ts
const EDGE_TYPES = { orthogonal: OrthogonalLineageEdge };

<ReactFlow
  nodes={flowNodes}
  edges={audited.edges.map((edge) => ({ ...toFlowEdge(edge), type: "orthogonal" }))}
  edgeTypes={EDGE_TYPES}
  nodesDraggable={false}
  panOnDrag
  zoomOnScroll
/>
```

- [ ] **步骤 6：实现证据详情检查器和虚拟列表**

点击 `data-testid="lineage-evidence-capsule"` 后先查隔离缓存，再调用 `loadEvidencePath(pathId, signal)`；检查器按 node/edge/event order 展示完整链。固定行高 56px、overscan 4，只渲染可视区；关闭时清除当前 detail state，但保留项目/revision 隔离缓存。

- [ ] **步骤 7：修正统计口径**

左/右栏分别显示：evidence 已加载、answer graph、canvas 可见、语义隐藏、用户折叠、几何证据束。canvas edge 数直接取最终传给 React Flow 的 edges，排除 `HAS_COLUMN` 和 `bundledEdgeIds`；检查器显示 `当前显示数 / 总关系数`。

- [ ] **步骤 8：接入 App 默认 answer 与详情 loader**

`ProjectGraphWorkspace` 向 `LineageGraphFlow` 传 `projectId={props.project.id}` 和 `loadEvidencePath`；`loadLineageNode`、搜索、reset 均显式使用 `view:"answer"`。项目切换时 abort traversal/detail 并让缓存 key 切换。

- [ ] **步骤 9：运行单元测试、类型检查和构建**

运行：`npx vitest run test/lineage-answer-view-model.test.ts test/lineage-collapse-model.test.ts test/lineage-workbench-layout.test.ts`

预期：PASS。

运行：`npm run typecheck`

预期：PASS。

运行：`npm run build:web`

预期：PASS，构建中不再出现类型化血缘 `smoothstep` 调用。

- [ ] **步骤 10：提交 Web 编排**

```bash
git add web/src/components/LineageGraphFlow.tsx web/src/components/lineage-graph/LineageCanvasNodes.tsx web/src/components/lineage-graph/LineageWorkbenchPanels.tsx web/src/components/lineage-graph/LineageEvidenceInspector.tsx web/src/components/lineage-graph/workbench-layout.ts web/src/App.tsx test/lineage-workbench-layout.test.ts
git commit -m "feat(图谱): 完成答案安全血缘工作台交互"
```

## 任务 8：迁移到确定性 Playwright fixture 并进入 CI

**文件：**
- 创建：`web/src/lineage-fixture-main.tsx`
- 创建：`web/lineage-fixture.html`
- 创建：`test/e2e/lineage-workbench.spec.ts`
- 创建：`playwright.config.ts`
- 修改：`vite.config.ts`
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`.github/workflows/ci.yml`
- 删除：`scripts/verify-lineage-ui.mjs`

- [ ] **步骤 1：先加入 Playwright 命令并确认红灯**

将 `test:lineage-ui` 设为 `playwright test test/e2e/lineage-workbench.spec.ts --project=chromium`，运行：`npm run test:lineage-ui`。

预期：FAIL，当前缺少 `@playwright/test`、配置和 fixture 页面。

- [ ] **步骤 2：安装测试依赖并生成 lockfile**

运行：`npm install --save-dev @playwright/test@^1.61.1 --registry=https://registry.npmmirror.com`

预期：`package.json` 和 `package-lock.json` 更新；移除直接 `playwright-core` devDependency，测试代码统一从 `@playwright/test` 导入。

- [ ] **步骤 3：创建独立 fixture 页面**

`lineage-fixture-main.tsx` 渲染 268px 展开的项目侧栏和真实 `LineageGraphFlow`；`loadNode` 从 `TRAVERSAL_PAGES` 返回，`loadEvidencePath` 返回 `EVIDENCE_PATH_FIXTURE`，并把请求计数写到 `data-testid="fixture-request-count"`。Vite 配置把 `index.html` 与 `lineage-fixture.html` 都设为 build input。

- [ ] **步骤 4：配置 Playwright Linux Chromium**

```ts
export default defineConfig({
  testDir: "./test/e2e",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run dev:web",
    url: "http://127.0.0.1:5173/lineage-fixture.html",
    reuseExistingServer: !process.env.CI
  }
});
```

- [ ] **步骤 5：写五档视口和 bounding-box 验收**

```ts
for (const width of [390, 768, 1280, 1440, 1720]) {
  test(`lineage workbench ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/lineage-fixture.html");
    await page.getByTestId("lineage-node-table").first().click();

    if (width === 1280 || width === 1440) {
      const canvas = await page.getByTestId("lineage-canvas").boundingBox();
      const inspector = await page.getByTestId("lineage-selected-node-panel").boundingBox();
      expect(canvas?.width).toBeGreaterThanOrEqual(480);
      expect(intersectionArea(canvas!, inspector!)).toBe(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

function intersectionArea(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}
```

- [ ] **步骤 6：补齐交互与几何断言**

在同一 spec 断言：主画布无隐藏名称；证据胶囊点击后检查器显示完整链；上游折叠不影响下游并可精确恢复；字段收起保留选中字段；隐藏字段后请求计数不因字段 frontier 增加；自定义边 path 为 `M/L` 正交段；`data-testid="lineage-geometry-audit"` 四项为 0；K3,3 fixture 的 bundled 数大于 0；390/768 drawer 完全位于视口并可关闭。

- [ ] **步骤 7：运行浏览器测试并确认绿灯**

运行：`npx playwright install chromium`

预期：Chromium 安装成功。

运行：`npm run test:lineage-ui`

预期：PASS，390、768、1280、1440、1720 五档用例全部通过。

- [ ] **步骤 8：接入 CI 和失败产物**

在 `.github/workflows/ci.yml` 的 build 后加入：

```yaml
      - run: npx playwright install --with-deps chromium
      - run: npm run test:lineage-ui
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: lineage-workbench-playwright
          path: |
            playwright-report/
            test-results/
            web/src/fixtures/lineage-workbench-fixture.ts
```

Playwright 失败时用 `testInfo.attach` 附加当前 DOM、fixture JSON 和 `lineage-geometry-audit` JSON。

- [ ] **步骤 9：删除旧视觉脚本并提交**

```bash
git rm scripts/verify-lineage-ui.mjs
git add web/src/lineage-fixture-main.tsx web/lineage-fixture.html test/e2e/lineage-workbench.spec.ts playwright.config.ts vite.config.ts package.json package-lock.json .github/workflows/ci.yml
git commit -m "test(图谱): 将工作台验收接入 Playwright CI"
```

## 任务 9：更新说明并执行完整交付验证

**文件：**
- 修改：`README.md`
- 修改：`README-CN.md`
- 修改：`DESIGN.md`

- [ ] **步骤 1：更新中英文 README**

明确默认 `view=answer`、证据胶囊显式加载详情、方向/字段独立折叠、节点不可拖动、正交路由、几何审计、非平面证据束和 `npm run test:lineage-ui`。不得写成已实时回查 SQL SQLite；只声明与当前已摄取 graph revision 一致。

- [ ] **步骤 2：更新项目 DESIGN.md**

补充三栏阈值 `956px`、列宽 `190 / minmax(480px,1fr) / 286`、窄屏抽屉、`epsilon=0.5 CSS px`、稳定降级顺序和隐藏详情只进检查器的规则。

- [ ] **步骤 3：运行完整单元测试**

运行：`npm test`

预期：PASS，全部 Vitest 测试通过。

- [ ] **步骤 4：运行类型、构建和 OpenSpec 检查**

运行：`npm run typecheck`

预期：PASS。

运行：`npm run build`

预期：PASS。

运行：`node scripts/openspec-ci-check.mjs`

预期：输出 `OpenSpec governance check passed.`。

- [ ] **步骤 5：运行最终浏览器验收**

运行：`npm run test:lineage-ui`

预期：PASS，五档视口、证据、折叠、预算、端口、几何和面板断言全部通过。

- [ ] **步骤 6：确认没有新增图引擎**

运行：`npm ls @xyflow/react elkjs`

预期：仅列出仓库既有的 `@xyflow/react` 与 `elkjs`，没有第二套图渲染或布局引擎。

- [ ] **步骤 7：提交说明并记录最终状态**

```bash
git add README.md README-CN.md DESIGN.md
git commit -m "docs(图谱): 说明答案安全工作台边界"
git status --short
```

预期：提交成功，`git status --short` 无输出。
