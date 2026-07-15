# Answer-safe 血缘服务实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在不改变普通文档与 `sag_search` 行为的前提下，让 SAG 严格摄取 `snw.sql_lineage_event.v3`，保留完整 evidence graph，并通过 revision 绑定的 answer projector、canonical fact 校验和固定模板渲染，向 HTTP 与 MCP 提供默认不泄漏临时实体的类型化血缘答案。

**架构：** 数据库仍只持久化完整 evidence graph；v3 语义写入实体 JSONB，证据锚点写入事件 JSONB，不新增列。专用 lineage repository 读取租户和项目隔离的 evidence snapshot 并计算稳定 revision，纯 projector 在查询时生成 answer graph、`sagpath:` 摘要和 canonical facts；HTTP、MCP 与会话答案统一经过 lineage service 和 renderer，revision 变化时最多重试一次，仍不稳定则安全失败。

**技术栈：** Node.js 20、TypeScript、Zod、PostgreSQL/JSONB、Fastify、Model Context Protocol SDK、Vitest、GitHub Actions。

---

## 实施边界

- 本计划只覆盖服务端：v3 摄取、evidence/answer 投影、graph revision、`sagpath:`、canonical fact、HTTP、MCP、会话答案安全、兼容回归与 CI 服务端门禁。
- 不修改 `web/`、React Flow、ELK、画布折叠、几何审计或 Playwright 视觉验收；这些内容应由独立 Web 计划交付。
- 不新增数据库列或 SQL 解析器，不连接或监听 SQL lineage 的 SQLite；SAG 只对已经摄取的 revision 作一致性承诺。
- `snw.sql_lineage_event.v1/v2`、普通 Markdown/TXT 抽取、`sag_search` sections/trace 和现有检索算法必须保持兼容。
- 每个任务完成后只提交该任务列出的文件；开始任务前先执行 `git status --short`，不得覆盖工作树中不属于本计划的改动。

## 文件职责

### 新建文件

- `src/lineage/contracts.ts`：v3 evidence/semantics schema，以及 evidence、answer、path、canonical fact 的共享服务端类型。
- `src/lineage/revision.ts`：规范化排序、graph revision、`sagpath:` 和 `sagfact:` 的稳定哈希。
- `src/lineage/answer-projector.ts`：从只读 evidence snapshot 生成 answer graph 和内存 path detail 索引。
- `src/lineage/canonical-answer.ts`：canonical fact 生成、严格 selection 校验、固定模板渲染和防御性泄漏扫描。
- `src/lineage/errors.ts`：HTTP、MCP、SSE 共用的安全错误码与状态映射。
- `src/db/lineage-repository.ts`：在一致数据库快照内读取 active evidence graph，不承担投影或渲染。
- `src/services/lineage-service.ts`：组织 snapshot、投影、分页、path detail 和 revision 校验。
- `src/services/lineage-answer-service.ts`：执行严格 fact 选择、一次结构化重试、revision 重试和 fail-closed 渲染。
- `test/fixtures/lineage-v3-envelope.ts`：确定性的合法/非法 v3 信封构造器。
- `test/fixtures/lineage-evidence-graph.ts`：包含业务节点、临时链、evidence-only 节点、分支、单端路径、环和隐藏连通分量的固定图。
- `test/lineage-v3-ingestion.test.ts`：JSONB 合并、语义冲突和事务回滚测试。
- `test/lineage-answer-projector.test.ts`：双图投影与隐藏名称防泄漏测试。
- `test/lineage-revision-path.test.ts`：revision、pathId、租户/项目/过期边界测试。
- `test/lineage-canonical-answer.test.ts`：canonical provenance、严格 selection 和 renderer 测试。
- `test/lineage-answer-service.test.ts`：结构化重试、revision 重试和固定安全失败测试。
- `test/lineage-http.test.ts`：Fastify 默认 answer、显式 evidence、path detail 和错误映射测试。
- `test/mcp-lineage-tools.test.ts`：MCP 协议级工具注册、输入约束和防泄漏测试。
- `test/mcp-agent-answer-safety.test.ts`：模型自由正文不得进入持久化消息或 SSE delta 的回归测试。

### 修改文件

- `src/types.ts`：给结构化抽取结果增加可选 schema、semantics、evidence，并扩展 lineage 响应类型。
- `src/ingestion/extract/structured-event.ts`：在 v1/v2 旁增加严格 v3 分支，继续复用关系闭包与关系形状校验。
- `src/services/ingestion-service.ts`：在同一事务内写 source/document/event/entity/relation，并传递 v3 JSONB。
- `src/db/repositories.ts`：扩展 `upsertEntity()` 的 metadata 合并与冲突拒绝；移除旧 lineage 查询实现并从专用 repository 重导出兼容入口。
- `src/services/webui-service.ts`：让 `getLineageGraph()` 和 path detail 委托 `lineageService`。
- `src/api/server.ts`：增加 `view`、方向、path detail、selection render 路由和安全错误映射。
- `src/mcp/server.ts`：注册 `sag_trace_lineage` 与 `sag_get_lineage_evidence_path`，调用共享 service。
- `src/services/mcp-settings-service.ts`：公开两项新工具的严格 schema 与示例。
- `src/services/mcp-agent-service.ts`：把血缘 fact 选择与通用自由文本规划分流，渲染完成前不发送模型 token。
- `test/extractor.test.ts`：补齐 v3 严格 wire、五类 category 与 v1/v2 兼容用例。
- `test/structured-ingestion-preparation.test.ts`：证明 v3 经过现有 embedding 准备流程时不调用 LLM 且不丢语义。
- `test/lineage-graph-repository.test.ts`：改为验证完整 evidence snapshot、租户/归档/删除过滤与 revision 输入字段。
- `package.json`：增加服务端 answer-safe 聚焦测试命令。
- `.github/workflows/ci.yml`：在通用测试前执行 answer-safe 服务端门禁。
- `README.md`、`README-CN.md`：记录 v3、默认 answer view、显式 evidence/path 和两个新 MCP 工具。

## 固定协议决策

以下格式在任务间保持不变，实施时不得另起一套名字：

```ts
export type LineageRole = "business" | "temporary" | "evidence_only";
export type LineageView = "answer" | "evidence";
export type LineageDirection = "upstream" | "downstream" | "both";

export interface EvidencePathSummary {
  pathId: string;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  hiddenNodeCount: number;
  relationTypes: string[];
  evidenceCount: number;
  eventIds: string[];
}

export interface CanonicalLineageAnswerFact {
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
```

- `graphRevision` 格式为 `sagrev:<64 位小写十六进制>`；哈希输入包含租户、项目、投影版本，以及排序后的 active nodes、edges、event evidence。
- `pathId` 格式为 `sagpath:<revision digest>:<path digest>`；path digest 包含投影版本、可见端点和有序 evidence edge IDs。
- `answerFactId` 格式为 `sagfact:<64 位小写十六进制>`；哈希输入同时绑定 tenant、project、graph revision、查询上下文、方向和 canonical provenance。
- `sqlpath:` 一律不由 SAG 接受或签发；`sagpath:` 一律不进入 v3 信封或数据库 metadata。
- HTTP 错误码固定为：非法/外部 path `400 INVALID_LINEAGE_PATH_ID`，不存在或越权 `404 LINEAGE_PATH_NOT_FOUND`，过期 revision `409 LINEAGE_REVISION_STALE`，两次 revision 不稳定 `503 LINEAGE_REVISION_UNSTABLE`，两次 selection 非法 `422 LINEAGE_SELECTION_REJECTED`。
- 安全失败正文固定为：`当前血缘图发生变化或答案选择未通过校验，请重新查询。`；不得拼接模型、数据库或隐藏实体原文。

### 任务 1：建立严格 v3 契约与解析

**文件：**
- 创建：`src/lineage/contracts.ts`
- 创建：`test/fixtures/lineage-v3-envelope.ts`
- 修改：`src/types.ts:190-219`
- 修改：`src/ingestion/extract/structured-event.ts:7-112`
- 修改：`test/extractor.test.ts`

- [ ] **步骤 1：创建合法 v3 fixture，并先写成功与兼容失败测试**

在 `test/fixtures/lineage-v3-envelope.ts` 导出 `validLineageV3Envelope()`，固定使用三个带前缀 SHA-256 ID、相对 POSIX 路径、可空 Git commit 和完整 span。然后在 `test/extractor.test.ts` 增加以下核心断言：

```ts
it.each([
  "TASK_PRODUCES_TABLE",
  "TABLE_DATA_FLOW",
  "SQL_TABLE_JOIN",
  "TABLE_TO_COLUMN_LINEAGE",
  "COLUMN_TO_COLUMN_LINEAGE"
])("accepts v3 category %s without calling the LLM", async (category) => {
  const envelope = validLineageV3Envelope({ category });
  const events = await extractEventsFromChunk({
    llm: rejectingLlm(),
    documentTitle: "lineage",
    heading: "statement",
    content: envelope.content,
    rawContent: sagEventBlock(envelope),
    references: []
  });

  expect(events[0]).toMatchObject({
    schema: "snw.sql_lineage_event.v3",
    category,
    evidence: envelope.evidence,
    entities: expect.arrayContaining([
      expect.objectContaining({ semantics: { role: "temporary" } })
    ])
  });
});

it("keeps v2 output free of inferred semantics and evidence", async () => {
  const [event] = await extractEventsFromChunk(v2ChunkInput(rejectingLlm()));
  expect(event.schema).toBe("snw.sql_lineage_event.v2");
  expect(event.evidence).toBeUndefined();
  expect(event.entities.every((entity) => entity.semantics === undefined)).toBe(true);
});
```

- [ ] **步骤 2：运行解析测试，确认 RED**

运行：`npx vitest run test/extractor.test.ts -t "v3 category|free of inferred"`

预期：FAIL；首个用例报告 `Invalid structured SAG event`，因为 discriminated union 尚不接受 `snw.sql_lineage_event.v3`。

- [ ] **步骤 3：补齐拒绝未知字段、绝对路径、ID/hash、Git commit、span、role 和冲突语义测试**

使用 `structuredClone(validLineageV3Envelope())` 分别变异一个字段，逐项断言拒绝；不得把多个错误压成一个只证明“任意错误会失败”的用例：

```ts
it.each([
  ["unknown evidence field", (value: any) => { value.evidence.absolutePath = "/repo/a.sql"; }],
  ["absolute relativePath", (value: any) => { value.evidence.relativePath = "/repo/a.sql"; }],
  ["parent relativePath", (value: any) => { value.evidence.relativePath = "../a.sql"; }],
  ["uppercase contentHash", (value: any) => { value.evidence.contentHash = "A".repeat(64); }],
  ["wrong repositoryId prefix", (value: any) => { value.evidence.repositoryId = `file:${"a".repeat(64)}`; }],
  ["invalid gitCommit", (value: any) => { value.evidence.gitCommit = "abc"; }],
  ["zero-based line", (value: any) => { value.evidence.span.startLine = 0; }],
  ["reversed byte span", (value: any) => { value.evidence.span.endByte = value.evidence.span.startByte; }],
  ["invalid semantics role", (value: any) => { value.entities[0].semantics.role = "internal"; }]
])("rejects v3 %s", async (_name, mutate) => {
  const envelope: any = validLineageV3Envelope();
  mutate(envelope);
  await expect(extractEventsFromChunk(chunkInput(envelope, rejectingLlm())))
    .rejects.toThrow("Invalid structured SAG event");
});
```

另加一个重复实体同名但 role 不同的用例，要求在去重前拒绝；保留现有 v2 端点、`contextTask` 闭包和 relation shape 测试，证明 v3 复用同一验证函数。

- [ ] **步骤 4：实现最小 v3 schema 与抽取类型**

在 `src/lineage/contracts.ts` 定义并导出严格 schema；路径校验同时拒绝反斜杠、空段、`.`、`..` 和绝对路径：

```ts
const sha256 = /^[0-9a-f]{64}$/;
const prefixedSha256 = (prefix: "repo" | "file" | "stmt") =>
  z.string().regex(new RegExp(`^${prefix}:[0-9a-f]{64}$`));

export const lineageSemanticsSchema = z.object({
  role: z.enum(["business", "temporary", "evidence_only"])
}).strict();

export const sourceSpanSchema = z.object({
  startByte: z.number().int().min(0),
  endByte: z.number().int().positive(),
  startLine: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().positive()
}).strict().superRefine((span, ctx) => {
  if (span.endByte <= span.startByte) {
    ctx.addIssue({ code: "custom", path: ["endByte"], message: "endByte must be greater than startByte" });
  }
  if (span.endLine < span.startLine || (span.endLine === span.startLine && span.endColumn < span.startColumn)) {
    ctx.addIssue({ code: "custom", path: ["endLine"], message: "span end must not precede span start" });
  }
});

export const sqlLineageEvidenceSchema = z.object({
  repositoryId: prefixedSha256("repo"),
  fileId: prefixedSha256("file"),
  statementId: prefixedSha256("stmt"),
  relativePath: z.string().min(1).refine((value) => {
    const segments = value.split("/");
    return !value.startsWith("/") && !value.includes("\\") &&
      segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  }, "relativePath must be a normalized POSIX repository-relative path"),
  contentHash: z.string().regex(sha256),
  gitCommit: z.union([z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/), z.null()]),
  dialect: z.string().trim().min(1),
  parserVersion: z.string().trim().min(1),
  span: sourceSpanSchema
}).strict();
```

给 `ExtractedEvent` 增加 `schema?`、`evidence?`，给 `ExtractedEntity` 增加 `semantics?`。在 `structured-event.ts` 新增 v3 schema，并让 v1、v2 返回自身 schema；v3 执行 `validateRelations()` 后再执行 `validateEntitySemanticsConsistency()`，不得从名称推断 role。

- [ ] **步骤 5：运行解析与准备流程测试，确认 GREEN**

运行：`npx vitest run test/extractor.test.ts test/structured-ingestion-preparation.test.ts`

预期：两个文件全部 PASS；测试输出中没有 LLM stub 被调用。

- [ ] **步骤 6：提交 v3 契约**

```bash
git add src/lineage/contracts.ts src/types.ts src/ingestion/extract/structured-event.ts test/fixtures/lineage-v3-envelope.ts test/extractor.test.ts test/structured-ingestion-preparation.test.ts
git commit -m "feat(lineage): 校验 v3 语义与证据契约"
```

### 任务 2：事务化持久化 v3 语义与事件证据

**文件：**
- 创建：`test/lineage-v3-ingestion.test.ts`
- 修改：`src/services/ingestion-service.ts:55-310`
- 修改：`src/db/repositories.ts:356-390`

- [ ] **步骤 1：先写 metadata 合并与冲突的 repository 失败测试**

mock `src/db/pool.ts`，调用扩展后的 `upsertEntity()`，断言 SQL 和参数满足：v3 只合并 `lineageSemantics`、v1/v2 传空 metadata、冲突时查询无返回行并抛出稳定错误。

```ts
it("merges only lineageSemantics and preserves existing metadata", async () => {
  db.query.mockResolvedValueOnce({ rows: [{ id: "type-1" }] });
  db.query.mockResolvedValueOnce({ rows: [{
    id: "entity-1", source_id: SOURCE_ID, type: "table", name: "stage.tmp_a",
    normalized_name: "stage.tmp_a", metadata: {
      owner: "data-team",
      lineageSemantics: { role: "temporary", sourceSchema: "snw.sql_lineage_event.v3" }
    }
  }] });

  await upsertEntity({
    sourceId: SOURCE_ID,
    type: "table",
    name: "stage.tmp_a",
    description: "temporary table",
    embedding: [1, 0],
    metadata: { lineageSemantics: { role: "temporary", sourceSchema: "snw.sql_lineage_event.v3" } }
  });

  const sql = normalizeSql(db.query.mock.calls[1][0]);
  expect(sql).toContain("entities.metadata || excluded.metadata");
  expect(sql).toContain("entities.metadata->'lineageSemantics'");
  expect(sql).toContain("returning *");
});
```

- [ ] **步骤 2：运行 repository 测试，确认 RED**

运行：`npx vitest run test/lineage-v3-ingestion.test.ts -t "lineageSemantics"`

预期：FAIL；TypeScript 报 `metadata` 不是 `upsertEntity` 的输入字段，或 SQL 不包含 JSONB 合并条件。

- [ ] **步骤 3：实现并发安全的 `upsertEntity()` 语义合并**

为输入增加 `metadata?: Record<string, unknown>`。`ON CONFLICT ... DO UPDATE` 只在新旧语义不冲突时执行；若 `RETURNING` 为空，抛 `LineageSemanticsConflictError`，让外层事务整体回滚：

```sql
on conflict (source_id, type, normalized_name) do update set
  name = excluded.name,
  description = coalesce(nullif(entities.description, ''), excluded.description),
  embedding = coalesce(entities.embedding, excluded.embedding),
  metadata = entities.metadata || excluded.metadata,
  updated_at = now()
where not (
  excluded.metadata ? 'lineageSemantics'
  and entities.metadata ? 'lineageSemantics'
  and entities.metadata->'lineageSemantics' <> excluded.metadata->'lineageSemantics'
)
returning *
```

插入参数必须包含 `JSON.stringify(input.metadata ?? {})`。空返回行时错误只包含实体 type/name，不打印已有 metadata 或 SQL evidence。

- [ ] **步骤 4：先写完整摄取的 RED 测试**

在 `test/lineage-v3-ingestion.test.ts` mock transaction client 和 embeddings，覆盖以下三个事务序列：

1. 合法 v3 的 event insert 参数含 `{ traceId, sqlLineageEvidence }`，entity upsert 含 `{ lineageSemantics: { role, sourceSchema } }`。
2. 同一 source 的 v2 后接 v3 可补齐语义；v3 后接 v2 不清除语义。
3. 第二个实体 role 冲突时调用 `rollback`，且没有 `commit`；document/event/relation 均不留在事务外。

运行：`npx vitest run test/lineage-v3-ingestion.test.ts -t "rolls back|sqlLineageEvidence|does not clear"`

预期：FAIL；event metadata 当前只有 `traceId`，source 仍在事务前创建，entity upsert 未收到 metadata。

- [ ] **步骤 5：把 source 与全部图写入收敛到同一事务**

在 `ingestDocument()` 中先确定 `sourceId`，完成不会写数据库的 chunk/embedding 准备，再开始事务；`createSource(..., client)`、document、event、entity 和 relation 全部使用该 client。metadata 映射固定为：

```ts
function eventMetadata(event: ExtractedEvent, traceId: string): Record<string, unknown> {
  return event.schema === "snw.sql_lineage_event.v3"
    ? { traceId, sqlLineageEvidence: event.evidence }
    : { traceId };
}

function entityMetadata(event: ExtractedEvent, entity: ExtractedEntity): Record<string, unknown> {
  return event.schema === "snw.sql_lineage_event.v3" && entity.semantics
    ? { lineageSemantics: { role: entity.semantics.role, sourceSchema: event.schema } }
    : {};
}
```

每一次 v3 声明都必须调用 `upsertEntity()` 以触发数据库冲突检查；不能因为 `persistedEntityIds` 已命中而跳过后续 role 校验。关系 metadata 继续写 `{}`，因为 evidence 只存于 event。

- [ ] **步骤 6：运行摄取测试，确认 GREEN**

运行：`npx vitest run test/lineage-v3-ingestion.test.ts test/structured-ingestion-preparation.test.ts test/extractor.test.ts`

预期：全部 PASS；冲突用例观测到 `begin`、`rollback`，未观测到 `commit`。

- [ ] **步骤 7：提交事务持久化**

```bash
git add src/services/ingestion-service.ts src/db/repositories.ts test/lineage-v3-ingestion.test.ts
git commit -m "feat(lineage): 事务化持久化 v3 语义证据"
```

### 任务 3：读取一致 evidence snapshot 并计算 graph revision

**文件：**
- 创建：`src/lineage/revision.ts`
- 创建：`src/db/lineage-repository.ts`
- 创建：`test/fixtures/lineage-evidence-graph.ts`
- 修改：`src/lineage/contracts.ts`
- 修改：`src/db/repositories.ts:1094-1329`
- 修改：`test/lineage-graph-repository.test.ts`

- [ ] **步骤 1：先写 evidence snapshot 的 SQL 边界测试**

将现有 repository 测试改为导入 `getLineageEvidenceSnapshot()`，断言查询同时返回 entity metadata、event metadata、全部真实关系，并保留现有租户、项目归档、document 归档和 event 删除过滤：

```ts
expect(sql).toContain("ent.metadata as entity_metadata");
expect(sql).toContain("e.metadata as event_metadata");
expect(sql).toContain("s.tenant_id = $2");
expect(sql).toContain("s.archived_at is null");
expect(sql).toContain("d.archived_at is null");
expect(sql).toContain("e.deleted_at is null");
expect(sql).not.toContain("task_dependencies as");
```

这里不得在 repository 中生成 `DEPENDS_ON` 伪边；evidence snapshot 只返回数据库真实节点和关系，派生关系属于 projector。

- [ ] **步骤 2：运行 repository 测试，确认 RED**

运行：`npx vitest run test/lineage-graph-repository.test.ts`

预期：FAIL；`getLineageEvidenceSnapshot` 尚未导出。

- [ ] **步骤 3：定义 snapshot DTO 与确定性 fixture**

在 `contracts.ts` 增加 `LineageEvidenceNode`、`LineageEvidenceEdge`、`LineageEvidenceSnapshot`。历史实体缺少 `lineageSemantics` 时只在读取 DTO 时映射为 `role: "business"` 和 `roleSource: "legacy-default"`，不得回写数据库。

`test/fixtures/lineage-evidence-graph.ts` 必须导出固定图，其中至少包含：

```ts
export const lineageIds = {
  businessA: "00000000-0000-0000-0000-000000000101",
  temporaryA: "00000000-0000-0000-0000-000000000102",
  evidenceOnlyA: "00000000-0000-0000-0000-000000000103",
  businessB: "00000000-0000-0000-0000-000000000104",
  businessC: "00000000-0000-0000-0000-000000000105",
  hiddenOnlyA: "00000000-0000-0000-0000-000000000106",
  hiddenOnlyB: "00000000-0000-0000-0000-000000000107"
} as const;
```

边形成 `businessA -> temporaryA -> evidenceOnlyA -> businessB`、从临时节点到 `businessC` 的分支、一个附着于 `businessB` 的单端路径、一个隐藏环和一个完全隐藏的连通分量；隐藏节点 displayName 使用显眼值 `SECRET_TMP_*`，便于防泄漏断言。

- [ ] **步骤 4：实现专用 repository 的一致读取**

`getLineageEvidenceSnapshot({ sourceId, tenantId })` 使用 client transaction：

```ts
await client.query("begin isolation level repeatable read read only");
try {
  const nodes = await loadLineageNodes(client, input);
  const edges = await loadLineageEdges(client, input);
  const snapshot = buildEvidenceSnapshot(input, nodes.rows, edges.rows);
  await client.query("commit");
  return snapshot;
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
}
```

nodes/edges 都必须按 ID 排序后映射；event evidence 只取 `event_metadata.sqlLineageEvidence`。若项目不存在、已归档或无权访问，返回 `null`，不得用“空图”掩盖越权。

- [ ] **步骤 5：先写 revision 稳定性测试并确认 RED**

```ts
it("is stable across row order and changes on answer-relevant data", () => {
  const first = evidenceFixture();
  const reordered = { ...first, nodes: [...first.nodes].reverse(), edges: [...first.edges].reverse() };
  expect(computeGraphRevision(first)).toBe(computeGraphRevision(reordered));

  const changed = structuredClone(first);
  changed.nodes[0].displayName = "renamed_business_table";
  expect(computeGraphRevision(changed)).not.toBe(computeGraphRevision(first));
});
```

运行：`npx vitest run test/lineage-revision-path.test.ts -t "stable across"`

预期：FAIL；`computeGraphRevision` 尚未定义。

- [ ] **步骤 6：实现规范化 revision 哈希并重导出兼容入口**

`computeGraphRevision()` 使用 `node:crypto` 的 SHA-256，规范化对象只包含允许影响投影或渲染的字段，并显式排序数组：

```ts
export function computeGraphRevision(snapshot: Omit<LineageEvidenceSnapshot, "graphRevision">): string {
  const canonical = {
    version: "answer-projector.v1",
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    nodes: [...snapshot.nodes].sort(byId).map(canonicalNode),
    edges: [...snapshot.edges].sort(byId).map(canonicalEdge)
  };
  return `sagrev:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}
```

从 `repositories.ts` 删除旧的投影 SQL 与 `task_dependencies` 伪边实现，并重导出专用 repository 的函数，避免 service 继续依赖大文件内部实现。

- [ ] **步骤 7：运行 snapshot/revision 测试，确认 GREEN**

运行：`npx vitest run test/lineage-graph-repository.test.ts test/lineage-revision-path.test.ts`

预期：全部 PASS；两次顺序不同的 fixture 得到完全相同的 `sagrev:`。

- [ ] **步骤 8：提交 evidence snapshot**

```bash
git add src/lineage/contracts.ts src/lineage/revision.ts src/db/lineage-repository.ts src/db/repositories.ts test/fixtures/lineage-evidence-graph.ts test/lineage-graph-repository.test.ts test/lineage-revision-path.test.ts
git commit -m "feat(lineage): 建立 evidence snapshot 与图版本"
```

### 任务 4：实现只读 answer projector 与 `sagpath:`

**文件：**
- 创建：`src/lineage/answer-projector.ts`
- 创建：`test/lineage-answer-projector.test.ts`
- 修改：`src/lineage/contracts.ts`
- 修改：`src/lineage/revision.ts`

- [ ] **步骤 1：先写业务链、分支、单端路径、环和隐藏分量测试**

核心断言必须同时检查投影正确性与默认 JSON 不泄漏：

```ts
it("collapses hidden chains without mutating evidence graph", () => {
  const evidence = evidenceFixture();
  const before = structuredClone(evidence);
  const projection = projectAnswerGraph(evidence);

  expect(evidence).toEqual(before);
  expect(projection.graph.nodes.every((node) => node.role === "business")).toBe(true);
  expect(projection.graph.evidencePathSummaries).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceNodeId: lineageIds.businessA,
      targetNodeId: lineageIds.businessB,
      hiddenNodeCount: 2
    })
  ]));
  expect(JSON.stringify(projection.graph)).not.toContain("SECRET_TMP_");
});

it("keeps complete hidden-only components out of the answer graph", () => {
  const projection = projectAnswerGraph(evidenceFixture());
  expect(projection.graph.nodes.map((node) => node.id)).not.toContain(lineageIds.hiddenOnlyA);
  expect([...projection.pathsById.values()].some((path) =>
    path.nodes.some((node) => node.id === lineageIds.hiddenOnlyA))).toBe(false);
});
```

再分别断言：分支生成两个稳定 path；单端路径一侧为 `null`；环按 edge ID 去重并有限终止；直接 business-to-business edge 原样保留。

- [ ] **步骤 2：运行 projector 测试，确认 RED**

运行：`npx vitest run test/lineage-answer-projector.test.ts`

预期：FAIL；无法导入 `projectAnswerGraph`。

- [ ] **步骤 3：实现 path ID 与 projector 的最小算法**

`createSagPathId()` 必须把 revision digest 放在可解析位置，并只对有序 edge IDs 哈希：

```ts
export function createSagPathId(input: {
  graphRevision: string;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  edgeIds: string[];
}): string {
  const revision = input.graphRevision.replace(/^sagrev:/, "");
  const digest = sha256(JSON.stringify({
    version: "answer-projector.v1",
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    edgeIds: input.edgeIds
  }));
  return `sagpath:${revision}:${digest}`;
}
```

`projectAnswerGraph()` 建立 outgoing/incoming adjacency；从每个 business 节点沿隐藏节点 DFS，到下一个 business 节点立即结束该路径，按当前 path 的 edge ID set 处理环。再从没有 business 上游的隐藏入口反向补齐单端路径。完全隐藏且不接触 business 的分量不产生摘要。每条 path detail 只保存在 `pathsById`，默认 graph 只引用 summary：

```ts
export interface AnswerProjection {
  graph: LineageGraphRecord;
  pathsById: ReadonlyMap<string, EvidencePathDetail>;
}

export function projectAnswerGraph(snapshot: LineageEvidenceSnapshot): AnswerProjection {
  const visibleIds = new Set(snapshot.nodes.filter(isBusiness).map((node) => node.id));
  const paths = collectMaximalHiddenPaths(snapshot, visibleIds);
  const direct = snapshot.edges.filter((edge) =>
    visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId));
  return buildProjection(snapshot, direct, paths, visibleIds);
}
```

`buildProjection()` 对 nodes、edges、summary 和 eventIds 全部稳定排序；投影 edge 只含业务端点、公开 relation label、evidence count 和 path IDs，不复制隐藏节点 metadata、description、alias 或 event content。

- [ ] **步骤 4：加入全响应递归防泄漏断言**

测试中收集 fixture 所有 `temporary/evidence_only` 的 displayName 与 alias，对 `JSON.stringify(projection.graph)` 逐一断言不存在；同时证明 `pathsById.get(pathId)` 仍包含完整有序隐藏链。

运行：`npx vitest run test/lineage-answer-projector.test.ts`

预期：全部 PASS；环用例在默认 Vitest 超时内完成，且 `pathsById.size` 稳定。

- [ ] **步骤 5：提交 answer projector**

```bash
git add src/lineage/contracts.ts src/lineage/revision.ts src/lineage/answer-projector.ts test/lineage-answer-projector.test.ts
git commit -m "feat(lineage): 投影答案图与证据路径摘要"
```

### 任务 5：建立 lineage service、path detail 与 revision 隔离

**文件：**
- 创建：`src/lineage/errors.ts`
- 创建：`src/services/lineage-service.ts`
- 修改：`src/services/webui-service.ts:308-314`
- 修改：`test/lineage-revision-path.test.ts`

- [ ] **步骤 1：先写 view、scope、prefix 与 stale path 的 service 测试**

向 `LineageService` 注入 fake repository，覆盖默认 answer、显式 evidence、当前 path、`sqlpath:`、格式错误、跨项目、不存在和 revision 过期：

```ts
it("rejects SQL lineage and stale SAG path ids", async () => {
  const service = serviceWithSnapshot(evidenceFixture());
  await expect(service.getEvidencePath({
    tenantId: "tenant-a", projectId: "project-a", pathId: "sqlpath:abc"
  })).rejects.toMatchObject({ code: "INVALID_LINEAGE_PATH_ID", statusCode: 400 });

  const oldPath = projectAnswerGraph(evidenceFixture()).graph.evidencePathSummaries[0].pathId;
  service.setSnapshot(evidenceFixture({ renamedBusinessNode: true }));
  await expect(service.getEvidencePath({
    tenantId: "tenant-a", projectId: "project-a", pathId: oldPath
  })).rejects.toMatchObject({ code: "LINEAGE_REVISION_STALE", statusCode: 409 });
});
```

- [ ] **步骤 2：运行 service 测试，确认 RED**

运行：`npx vitest run test/lineage-revision-path.test.ts -t "rejects SQL lineage|default answer|explicit evidence"`

预期：FAIL；`LineageService` 与 typed errors 尚未定义。

- [ ] **步骤 3：实现 typed error 与查询服务**

`LineageError` 只接受枚举 code、status 和固定 public message，内部 cause 只交给 logger：

```ts
export class LineageError extends Error {
  constructor(
    public readonly code: LineageErrorCode,
    public readonly statusCode: 400 | 404 | 409 | 422 | 503,
    message: string
  ) {
    super(message);
    this.name = "LineageError";
  }
}
```

`LineageService.getGraph()` 每次只读取一个 snapshot；`view="answer"` 调 projector，`view="evidence"` 返回完整节点/边但仍带 revision。`nodeId/query/direction/limit` 在投影后应用，避免分页切断隐藏路径。`getEvidencePath()` 的顺序固定为：解析 prefix 和 revision → 读取当前 scoped snapshot → 比较 revision → 在当前 projection 的 `pathsById` 精确查找 → 返回有序 detail。

- [ ] **步骤 4：实现 revision 读取与稳定执行原语**

为 canonical answer 提供通用的两次 snapshot 尝试，不把 revision 检查散落到 HTTP/MCP：

```ts
async withStableAnswerContext<T>(
  input: LineageQueryInput,
  work: (context: LineageAnswerContext) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const context = await this.getAnswerContext(input);
    const result = await work(context);
    const current = await this.repository.getRevision(input);
    if (current === context.graphRevision) return result;
  }
  throw lineageRevisionUnstable();
}
```

`getRevision()` 必须依据与 snapshot 相同的 active 数据定义；不允许读取 SQLite 或以数据库时间戳代替内容 revision。

- [ ] **步骤 5：让 WebUI service 只做代理并跑 GREEN**

`webuiService.getLineageGraph(projectId, input, tenantId)` 改为 `lineageService.getGraph({ projectId, tenantId, ...input })`；新增 `getLineageEvidencePath()`。不要改任何 `web/` 文件。

运行：`npx vitest run test/lineage-revision-path.test.ts test/lineage-answer-projector.test.ts test/lineage-graph-repository.test.ts`

预期：全部 PASS；`sqlpath:` 不触发 repository 查询，stale path 不返回旧 detail。

- [ ] **步骤 6：提交 lineage service**

```bash
git add src/lineage/errors.ts src/services/lineage-service.ts src/services/webui-service.ts test/lineage-revision-path.test.ts
git commit -m "feat(lineage): 隔离证据路径与图版本"
```

### 任务 6：生成 canonical fact 并确定性渲染

**文件：**
- 创建：`src/lineage/canonical-answer.ts`
- 创建：`test/lineage-canonical-answer.test.ts`
- 修改：`src/lineage/contracts.ts`
- 修改：`src/lineage/revision.ts`

- [ ] **步骤 1：先写 provenance 闭合和严格 selection 测试**

```ts
it("accepts only fact ids from the current query context", () => {
  const context = answerContextFixture();
  const facts = createCanonicalFacts(context);
  expect(validateLineageSelection({ answerFactIds: [facts[0].answerFactId] }, context, facts))
    .toEqual([facts[0]]);

  expect(() => validateLineageSelection({
    answerFactIds: [facts[0].answerFactId],
    pathId: facts[0].evidencePathIds[0]
  }, context, facts)).toThrow("LINEAGE_SELECTION_REJECTED");
});

it.each([
  { final: "SECRET_TMP_A" },
  { answerFactIds: ["sagfact:external"] },
  { answerFactIds: [], explanation: "derived through an internal step" },
  { answerFactIds: ["sagfact:old"], graphRevision: "sagrev:old" }
])("rejects non-canonical selection %#", (selection) => {
  expect(() => validateLineageSelection(selection, answerContextFixture(), [])).toThrow();
});
```

- [ ] **步骤 2：运行 canonical 测试，确认 RED**

运行：`npx vitest run test/lineage-canonical-answer.test.ts`

预期：FAIL；canonical 模块尚不存在。

- [ ] **步骤 3：实现 fact ID、strict schema 与上下文校验**

```ts
export const lineageAnswerSelectionSchema = z.object({
  answerFactIds: z.array(z.string().regex(/^sagfact:[0-9a-f]{64}$/)).min(1)
}).strict();

export function validateLineageSelection(
  raw: unknown,
  context: LineageAnswerContext,
  facts: readonly CanonicalLineageAnswerFact[]
): CanonicalLineageAnswerFact[] {
  const selection = lineageAnswerSelectionSchema.parse(raw);
  const available = new Map(facts.map((fact) => [fact.answerFactId, fact]));
  const selected = selection.answerFactIds.map((id) => available.get(id));
  if (selected.some((fact) => !fact) || selected.some((fact) => fact!.graphRevision !== context.graphRevision)) {
    throw lineageSelectionRejected();
  }
  return selected as CanonicalLineageAnswerFact[];
}
```

`createCanonicalFacts()` 只能从当前 answer edges/path summaries 构造 provenance；`answerFactId` 哈希输入包含 tenant、project、queryContextId、direction、revision 和 fact 全部 provenance。任何调用者都不能覆盖 relation/event/path IDs。

- [ ] **步骤 4：先写 renderer 输入白名单与隐藏词扫描测试**

测试将隐藏 node 的 name、description、alias、SQL 表达式和 event content 都放入 context，随后断言 renderer 输出只含业务 displayName、公开关系标签和 evidenceCount：

```ts
const text = renderCanonicalLineageAnswer(selectedFacts, renderContextFixture());
expect(text).toBe("dwd.orders 派生自 ods.orders（2 条证据）。");
expect(text).not.toMatch(/SECRET_TMP_|select |临时清洗步骤/i);
```

另加防御性用例：业务 displayName 被错误配置为与隐藏 alias 相同时，renderer 抛 `LINEAGE_SELECTION_REJECTED`，不返回部分文本。

- [ ] **步骤 5：实现固定模板 renderer**

公开 label 映射固定在服务端，renderer 参数不含 `EvidencePathDetail`、event summary/content 或实体 metadata：

```ts
const templates = {
  upstream: (source: string, target: string, count: number) => `${source} 是 ${target} 的上游（${count} 条证据）。`,
  downstream: (source: string, target: string, count: number) => `${target} 是 ${source} 的下游（${count} 条证据）。`,
  produces: (source: string, target: string, count: number) => `${source} 产出 ${target}（${count} 条证据）。`,
  joins: (source: string, target: string, count: number) => `${source} 与 ${target} 存在关联（${count} 条证据）。`,
  derived_from: (source: string, target: string, count: number) => `${target} 派生自 ${source}（${count} 条证据）。`
} satisfies Record<CanonicalLineageAnswerFact["claimType"],
  (source: string, target: string, count: number) => string>;
```

渲染完整字符串后，用 context 中显式 role 为 `temporary/evidence_only` 的 name/alias 做逐项扫描；扫描只作为防御，不以名称模式重新分类节点。

- [ ] **步骤 6：运行 canonical 测试，确认 GREEN**

运行：`npx vitest run test/lineage-canonical-answer.test.ts`

预期：全部 PASS；未知字段、外部 fact、旧 revision、错配 provenance 全部被拒绝。

- [ ] **步骤 7：提交 canonical answer**

```bash
git add src/lineage/contracts.ts src/lineage/revision.ts src/lineage/canonical-answer.ts test/lineage-canonical-answer.test.ts
git commit -m "feat(lineage): 校验并渲染规范血缘事实"
```

### 任务 7：实现稳定 revision 的答案编排并隔离模型自由文本

**文件：**
- 创建：`src/services/lineage-answer-service.ts`
- 创建：`test/lineage-answer-service.test.ts`
- 创建：`test/mcp-agent-answer-safety.test.ts`
- 修改：`src/services/mcp-agent-service.ts:22-58,107-225,294-354,469-632`

- [ ] **步骤 1：先写 selection 重试与 revision 重试测试**

向 `LineageAnswerService` 注入 `LineageService` 和 `selectFacts(prompt): Promise<unknown>`，覆盖以下精确调用次数：

```ts
it("retries one invalid selection and returns only renderer text", async () => {
  const select = vi.fn()
    .mockResolvedValueOnce({ final: "SECRET_TMP_A" })
    .mockResolvedValueOnce({ answerFactIds: [VALID_FACT_ID] });
  const result = await service({ select }).answer(queryInput());
  expect(select).toHaveBeenCalledTimes(2);
  expect(result.text).toBe("dwd.orders 派生自 ods.orders（2 条证据）。");
});

it("discards a changed revision and rebuilds the full context once", async () => {
  const lineage = lineageServiceWithRevisionSequence(["rev-a", "rev-b", "rev-b", "rev-b"]);
  const result = await service({ lineage }).answer(queryInput());
  expect(result.graphRevision).toBe("rev-b");
  expect(lineage.getAnswerContext).toHaveBeenCalledTimes(2);
});
```

再测试两次 selection 非法返回固定 422 安全失败、两次 revision 都变化返回固定 503 安全失败，任何错误对象都不含模型原文。

- [ ] **步骤 2：运行 answer service 测试，确认 RED**

运行：`npx vitest run test/lineage-answer-service.test.ts`

预期：FAIL；`LineageAnswerService` 尚不存在。

- [ ] **步骤 3：实现有界的双层重试**

外层最多两个 revision context，内层每个 context 最多两次严格 selection；只有 validator 通过且 revision 复核一致后才调用 renderer：

```ts
for (let revisionAttempt = 0; revisionAttempt < 2; revisionAttempt += 1) {
  const context = await lineageService.getAnswerContext(input);
  const facts = createCanonicalFacts(context);
  let selected: CanonicalLineageAnswerFact[] | null = null;
  for (let selectionAttempt = 0; selectionAttempt < 2; selectionAttempt += 1) {
    const raw = await selector.select(buildSelectionPrompt(context, facts, selectionAttempt));
    try {
      selected = validateLineageSelection(raw, context, facts);
      break;
    } catch {
      selected = null;
    }
  }
  if (!selected) throw lineageSelectionRejected();
  if (await lineageService.getRevision(input) !== context.graphRevision) continue;
  return { graphRevision: context.graphRevision, text: renderCanonicalLineageAnswer(selected, context) };
}
throw lineageRevisionUnstable();
```

selection prompt 只能要求 `{ "answerFactIds": ["sagfact:..."] }`；模型可读取显式 evidence detail 作为选择上下文，但 detail 不得传给 renderer。

- [ ] **步骤 4：先写 MCP 会话不直出模型 token 的 RED 测试**

mock `fetch` 依次返回 `call_tool: sag_trace_lineage` 和包含自由正文/隐藏名称的 `final`，收集 `runUserMessage()` emitter：

```ts
expect(events.filter((event) => event.type === "assistant_delta")
  .map((event: any) => event.delta).join(""))
  .not.toContain("SECRET_TMP_A");
expect(savedAssistant.content).toBe(SAFE_RENDERED_TEXT);
expect(savedAssistant.content).not.toBe(MODEL_FINAL_TEXT);
```

再覆盖 selection 两次失败时保存和发送的都是固定安全失败文案；`sag_search` 的普通自由文本回答保持现有行为。

- [ ] **步骤 5：在 `McpAgentService` 中分流血缘答案**

保留通用 `ToolAction` 给 `sag_search`。一旦本轮成功调用 `sag_trace_lineage`，`runLlmToolFlow()` 不再接受 `action.final` 作为输出，而是调用 `lineageAnswerService.answer()`；结果类型显式区分来源：

```ts
type AgentAnswer =
  | { kind: "general"; text: string }
  | { kind: "canonical_lineage"; text: string; graphRevision: string };
```

`runUserMessage()` 只对最终 `AgentAnswer.text` 分块；`canonical_lineage` 的 text 必须来自 renderer。移除把血缘模型 final、工具错误正文或 detail 直接写入 `assistantText` 的路径。更新 planner prompt：类型化血缘问题先调用 `sag_trace_lineage`；完整路径只在明确需要核验证据时调用详情工具；详情内容不得成为答案正文。

- [ ] **步骤 6：运行编排与兼容测试，确认 GREEN**

运行：`npx vitest run test/lineage-answer-service.test.ts test/mcp-agent-answer-safety.test.ts test/search-service.test.ts test/search-service-multi.test.ts`

预期：全部 PASS；血缘用例的 delta/消息不含模型原文，普通搜索用例输出契约不变。

- [ ] **步骤 7：提交答案编排**

```bash
git add src/services/lineage-answer-service.ts src/services/mcp-agent-service.ts test/lineage-answer-service.test.ts test/mcp-agent-answer-safety.test.ts
git commit -m "feat(lineage): 隔离模型选择与确定性答案"
```

### 任务 8：提供默认 answer 的 HTTP 契约

**文件：**
- 创建：`test/lineage-http.test.ts`
- 修改：`src/api/server.ts:72-78,258-265,584-617`
- 修改：`src/services/webui-service.ts`

- [ ] **步骤 1：先写 Fastify inject 的默认 answer 与显式 evidence 测试**

使用 `vi.hoisted()` mock `lineageService`，在 import `buildHttpServer()` 前完成 mock。断言：省略 view 时 service 收到 `answer`，显式 `view=evidence` 原样传递，默认响应 JSON 不含隐藏名称。

```ts
const answer = await app.inject({
  method: "GET",
  url: `/api/projects/${PROJECT_ID}/lineage-graph?nodeId=${NODE_ID}`
});
expect(answer.statusCode).toBe(200);
expect(lineage.getGraph).toHaveBeenCalledWith(expect.objectContaining({ view: "answer" }));
expect(answer.body).not.toContain("SECRET_TMP_A");

const evidence = await app.inject({
  method: "GET",
  url: `/api/projects/${PROJECT_ID}/lineage-graph?view=evidence&limit=50`
});
expect(evidence.statusCode).toBe(200);
expect(lineage.getGraph).toHaveBeenCalledWith(expect.objectContaining({ view: "evidence" }));
```

- [ ] **步骤 2：运行 HTTP view 测试，确认 RED**

运行：`npx vitest run test/lineage-http.test.ts -t "default answer|explicit evidence"`

预期：FAIL；query schema 会丢弃或拒绝 `view`，route 仍走旧 repository 委托。

- [ ] **步骤 3：扩展严格 query/body schema 与路由**

`lineageGraphQuerySchema` 增加 `view` 和 `direction` 并 `.strict()`；保留 `nodeId` 与 query 互斥。新增：

```ts
app.get("/api/projects/:projectId/lineage-evidence-paths/:pathId", async (request) => {
  const { projectId, pathId } = lineagePathParamsSchema.parse(request.params);
  return { path: await webuiService.getLineageEvidencePath(projectId, pathId) };
});

app.post("/api/projects/:projectId/lineage-answer", async (request) => {
  const { projectId } = projectParamsSchema.parse(request.params);
  const input = lineageAnswerSelectionRequestSchema.parse(request.body);
  return { answer: await lineageAnswerService.renderSubmittedSelection({ projectId, ...input }) };
});
```

selection request 只允许 `query`、`direction`、`graphRevision`、`answerFactIds`；`.strict()` 拒绝正文、端点、eventId、pathId 和 relationId。service 必须从同一查询上下文重建 facts 后验证 IDs，不能信任客户端 provenance。

- [ ] **步骤 4：先写 path/error/fail-closed 的 RED 测试**

分别让 mock 抛五类 `LineageError`，断言固定 status/code/message；404 对不存在与越权使用同一公开响应。SSE 血缘错误只发送固定安全 message，不调用通用 `getErrorMessage()` 暴露内部 cause。

运行：`npx vitest run test/lineage-http.test.ts -t "path error|selection error|SSE"`

预期：FAIL；全局 handler 当前除 Zod 外统一返回 500，SSE 会直接发送 error message。

- [ ] **步骤 5：实现统一 HTTP/SSE 错误映射**

```ts
if (error instanceof LineageError) {
  return reply.code(error.statusCode).send({
    error: { code: error.code, message: error.message }
  });
}
```

Zod 仍映射 400；未知异常映射固定 `500 INTERNAL_ERROR / 服务暂时不可用`，详细异常只写 logger。SSE 捕获 `LineageError` 时使用同一公开 code/message；未知异常只发送 `INTERNAL_ERROR`，不得发送数据库或模型 message。

- [ ] **步骤 6：运行 HTTP 测试，确认 GREEN**

运行：`npx vitest run test/lineage-http.test.ts test/upload-body-limit.test.ts`

预期：全部 PASS；原有 upload body limit 行为仍通过，默认 answer body 不含隐藏名称。

- [ ] **步骤 7：提交 HTTP 契约**

```bash
git add src/api/server.ts src/services/webui-service.ts test/lineage-http.test.ts
git commit -m "feat(lineage): 提供安全血缘 HTTP 接口"
```

### 任务 9：注册并验证两项 MCP 血缘工具

**文件：**
- 创建：`test/mcp-lineage-tools.test.ts`
- 修改：`src/mcp/server.ts:11-108`
- 修改：`src/services/mcp-settings-service.ts:19-84`

- [ ] **步骤 1：先写 MCP in-memory 协议测试**

使用 SDK 自带 transport，不直接调用私有 handler：

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = buildMcpServer({ lineageService: fakeLineageService });
const client = new Client({ name: "lineage-test", version: "1.0.0" });
await server.connect(serverTransport);
await client.connect(clientTransport);

const tools = await client.listTools();
expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
  "sag_trace_lineage",
  "sag_get_lineage_evidence_path",
  "sag_search"
]));
```

调用 trace 时设置 `SAG_MCP_SOURCE_ID`，断言 service 只收到配置项目，忽略/拒绝调用者提供的 project/source 字段；默认 view 是 answer，结果不含隐藏名称。

- [ ] **步骤 2：运行 MCP 注册测试，确认 RED**

运行：`npx vitest run test/mcp-lineage-tools.test.ts -t "registers|defaults to answer"`

预期：FAIL；工具列表中没有两项 lineage 工具，`buildMcpServer` 也尚不支持依赖注入。

- [ ] **步骤 3：实现 `sag_trace_lineage` 严格输入与共享 service 调用**

输入固定为：`nodeId?`、`query?` 二选一，`direction?`、`view?`、`limit?`；不接受 tenant/project/source。handler 使用 `readConfiguredSourceId()` 绑定项目：

```ts
server.tool("sag_trace_lineage", {
  nodeId: z.string().uuid().optional(),
  query: z.string().trim().min(1).max(200).optional(),
  direction: z.enum(["upstream", "downstream", "both"]).default("both"),
  view: z.enum(["answer", "evidence"]).default("answer"),
  limit: z.number().int().min(1).max(200).default(100)
}, async (input) => jsonContent(await lineageService.trace({
  ...input,
  projectId: readConfiguredSourceId(),
  tenantId: config.DEFAULT_TENANT_ID
})));
```

在 handler 内补二选一校验；answer 结果包含 graph revision、answer graph、`evidencePathSummaries` 和 canonical facts，evidence view 明确返回完整图但不把 path detail 混入默认 answer。

- [ ] **步骤 4：实现显式 path detail 工具和错误内容**

`sag_get_lineage_evidence_path` 只接受 `pathId`，调用共享 `getEvidencePath()`。`LineageError` 转成 `{ isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] }`；`sqlpath:`、stale、跨项目和不存在分别走任务 5 的边界。

协议测试必须断言：trace 返回的 `sagpath:` 可查询完整链；把 pathId 的 revision digest 或 project scope 改掉后失败；默认 trace JSON 永远不含 `SECRET_TMP_*`。

- [ ] **步骤 5：同步公开工具设置并验证 additionalProperties**

在 `mcp-settings-service.ts` 增加两项工具，JSON Schema 均使用现有 `objectSchema()`，因此 `additionalProperties: false`。示例不得包含真实项目 UUID、绝对路径或 `sqlpath:`。

运行：`npx vitest run test/mcp-lineage-tools.test.ts`

预期：全部 PASS；工具清单、协议调用、错误返回和公开 settings 保持一致。

- [ ] **步骤 6：提交 MCP 工具**

```bash
git add src/mcp/server.ts src/services/mcp-settings-service.ts test/mcp-lineage-tools.test.ts
git commit -m "feat(lineage): 增加精确血缘 MCP 工具"
```

### 任务 10：建立兼容回归、服务端 CI 门禁与文档

**文件：**
- 修改：`package.json`
- 修改：`.github/workflows/ci.yml`
- 修改：`README.md`
- 修改：`README-CN.md`
- 修改：`test/search-service.test.ts`（仅在缺少既有响应快照断言时增加断言）

- [ ] **步骤 1：先运行完整基线并记录真实失败**

运行：`npm test`

预期：在前九个任务完成后全部 PASS。若有失败，只修复与本计划改动直接相关的兼容问题；不得借机改搜索排序、普通文档抽取或 Web 视觉实现。

- [ ] **步骤 2：增加聚焦服务端测试脚本**

在 `package.json` 的 scripts 增加一条完整、无 glob 歧义的命令：

```json
"test:lineage-service": "vitest run test/extractor.test.ts test/structured-ingestion-preparation.test.ts test/lineage-v3-ingestion.test.ts test/lineage-graph-repository.test.ts test/lineage-answer-projector.test.ts test/lineage-revision-path.test.ts test/lineage-canonical-answer.test.ts test/lineage-answer-service.test.ts test/lineage-http.test.ts test/mcp-lineage-tools.test.ts test/mcp-agent-answer-safety.test.ts"
```

运行：`npm run test:lineage-service`

预期：命令退出码 0，列出的测试文件全部 PASS。

- [ ] **步骤 3：把 answer-safe 服务端门禁放进现有 CI**

在 `.github/workflows/ci.yml` 的 `npm ci --registry=https://registry.npmmirror.com` 之后、通用 `npm test` 之前增加：

```yaml
      - run: npm run test:lineage-service
      - run: npm test
      - run: npm run typecheck
      - run: npm run build
      - run: node scripts/openspec-ci-check.mjs
```

不增加 Chromium、Playwright 或 Web fixture；它们属于独立视觉交付计划。

- [ ] **步骤 4：补齐中英文服务端使用说明**

README 必须明确：

1. v3 的三种 role 和严格 evidence wire；绝对路径、未知字段、语义冲突会拒绝整次摄取。
2. `GET /api/projects/:projectId/lineage-graph` 默认 `view=answer`，只有显式 `view=evidence` 返回完整图。
3. `sagpath:` 只在当前 tenant/project/revision 有效，详情通过 HTTP path route 或 `sag_get_lineage_evidence_path` 获取；SAG 拒绝 `sqlpath:`。
4. `sag_trace_lineage` 是确定性血缘答案工具；`sag_search` 仍是通用证据召回工具。
5. SAG 不实时读取 SQL lineage SQLite；源码新鲜度和 raw 权威查询由 SQL lineage 服务承担。

- [ ] **步骤 5：执行四项交付验证**

依次运行：

```bash
npm run test:lineage-service
npm test
npm run typecheck
npm run build
node scripts/openspec-ci-check.mjs
```

预期：五条命令退出码均为 0；build 仍同时完成 API 与现有 Web 构建，OpenSpec 检查不报未声明行为。

- [ ] **步骤 6：执行泄漏与范围静态检查**

运行：

```bash
rg -n "SECRET_TMP_|sqlpath:" src/lineage src/services/lineage-service.ts src/services/lineage-answer-service.ts src/mcp/server.ts src/api/server.ts
git diff -- web/
git diff --check
git status --short
```

预期：第一条只命中明确拒绝 `sqlpath:` 的校验或测试数据，不在固定模板中命中隐藏 fixture 名；第二条无输出；`git diff --check` 无输出；status 只列出本计划范围内文件。

- [ ] **步骤 7：提交 CI 与文档**

```bash
git add package.json .github/workflows/ci.yml README.md README-CN.md test/search-service.test.ts
git commit -m "ci(lineage): 增加答案安全服务门禁"
```

## 最终验收矩阵

| 需求 | 证明测试/命令 |
| --- | --- |
| v3 五类 category、严格 role/evidence、未知字段与绝对路径拒绝 | `test/extractor.test.ts` |
| v1/v2 不写入或清除语义，普通结构化抽取不调用 LLM | `test/extractor.test.ts`、`test/structured-ingestion-preparation.test.ts` |
| JSONB 合并、首次补齐、冲突整体回滚 | `test/lineage-v3-ingestion.test.ts` |
| evidence graph 完整，answer graph 查询时投影且不持久化伪边 | `test/lineage-graph-repository.test.ts`、`test/lineage-answer-projector.test.ts` |
| 默认摘要不泄漏隐藏名称，显式 path 返回完整有序链 | `test/lineage-answer-projector.test.ts`、`test/lineage-revision-path.test.ts` |
| `sagpath:`/`sqlpath:` 隔离、tenant/project/revision 绑定 | `test/lineage-revision-path.test.ts`、`test/mcp-lineage-tools.test.ts` |
| projector → fact → validator → renderer 使用同一 revision | `test/lineage-answer-service.test.ts` |
| 模型只能选择 fact ID，模型正文与详情不进入 renderer/SSE | `test/lineage-canonical-answer.test.ts`、`test/mcp-agent-answer-safety.test.ts` |
| HTTP/MCP 默认 answer，显式 evidence/path detail | `test/lineage-http.test.ts`、`test/mcp-lineage-tools.test.ts` |
| `sag_search`、普通文档和现有构建兼容 | `test/search-service.test.ts`、`test/search-service-multi.test.ts`、`npm test`、`npm run build` |
| 服务端门禁进入 CI，视觉范围未混入 | `npm run test:lineage-service`、`git diff -- web/` |

