<p align="center">
  <img src="docs/assets/logo.svg" alt="Zleap AI" width="220" />
</p>

# SAG

> [!NOTE]
> 本仓库是上游 Zleap-AI/SAG 的 `snw-sag` 兼容分支。当前扩展增加版本化结构化事件信封、类型关系存储和按需图查询，使 SQL 血缘等确定性数据可以直接写入准确的 `task/table/column` 图；未携带信封的普通文档继续使用上游原有流程。


**Language**: English | [简体中文](README-CN.md)


> **SAG:** Graph retrieval technology capable of running on large-scale dynamic data.
> 
> **Paper:** [https://arxiv.org/abs/2606.15971](https://arxiv.org/abs/2606.15971)


This project is an out-of-the-box document retrieval workbench built on SAG. After you upload Markdown or TXT documents, SAG automatically handles chunking, vectorization, event extraction, entity extraction, and relation organization. You can ask questions over project documents in a ChatGPT-like interface, inspect chunks, events, entities, embeddings, search traces, raw model logs, and explore the knowledge graph.

本分支使用项目本地 `openspec/` 管理兼容扩展：`/opsx-propose` 创建变更，`/opsx-explore` 调研，`/opsx-apply` 实施，`/opsx-archive` 归档；新增功能和多文件改动必须先补齐 proposal、specs、design 和 tasks。

## Structured Event Envelope

确定性数据生产方可以在每个 Markdown section 中提供一个 `sag-event` 代码块。SAG 检测到信封后直接校验并保存事件，不调用 LLM 或本地文本实体猜测；信封无效时整次摄取失败。v1 与 v2 都只允许 `task`、`table`、`column` 三种实体类型，v2 额外要求显式 `relations` 并校验引用闭包。

````markdown
```sag-event
{
  "schema": "snw.sql_lineage_event.v2",
  "title": "字段加工：target.result 来自 source.a、source.b",
  "summary": "target.result 由两个上游字段共同加工。",
  "content": "目标字段 target.result 来自 source.a、source.b。",
  "category": "COLUMN_TO_COLUMN_LINEAGE",
  "keywords": ["target.result", "source.a", "source.b"],
  "entities": [
    { "type": "task", "name": "lineage_task", "description": "SQL 血缘任务" },
    { "type": "column", "name": "target.result", "description": "目标字段" },
    { "type": "column", "name": "source.a", "description": "上游字段" },
    { "type": "column", "name": "source.b", "description": "上游字段" }
  ],
  "relations": [
    {
      "source": { "type": "column", "name": "source.a" },
      "type": "DERIVED_FROM",
      "target": { "type": "column", "name": "target.result" },
      "contextTask": "lineage_task"
    },
    {
      "source": { "type": "column", "name": "source.b" },
      "type": "DERIVED_FROM",
      "target": { "type": "column", "name": "target.result" },
      "contextTask": "lineage_task"
    }
  ]
}
```
````

任务只通过 `PRODUCES` 指向写入目标表；表数据流和 JOIN 用 `contextTask` 保留执行任务；表字段归属和字段加工分别使用 `HAS_COLUMN` 与 `*_FROM`。图谱首屏读取受限数量的 `PRODUCES` 骨架，并从生产表和消费任务上下文推导 `DEPENDS_ON` 任务依赖；节点单击按一跳加载，实体搜索不读取全量关系：

```text
GET /api/projects/:projectId/lineage-graph?limit=100
GET /api/projects/:projectId/lineage-graph?nodeId=<entityId>&limit=200
GET /api/projects/:projectId/lineage-graph?query=<name>&limit=100
```

![SAG chat workbench](docs/assets/sag-chat.png)

## RAG SOTA and Benchmark

SAG benchmark reproduction code: [Zleap-AI/SAG-Benchmark](https://github.com/Zleap-AI/SAG-Benchmark)

SAG is a next-generation RAG approach designed for agents. Instead of stuffing more chunks into the model, it organizes document knowledge with a lighter structure:

```text
chunk -> event
chunk -> entities
event <-> entities
```

Each chunk extracts one complete event and multiple entities. The event preserves the full semantic unit, while entities build the index and enable relational expansion, so retrieval can start from a matched event and continue through multi-hop recall without the rebuild cost of a heavyweight knowledge graph.

![SAG architecture](docs/assets/paper-sag-architecture.jpeg)

On HotpotQA / 2WikiMultiHop / MuSiQue, under the same configuration:

```text
Embedding = bge-large-en-v1.5
LLM = qwen3.6-flash
Datasets = HotpotQA / 2WikiMultiHop / MuSiQue
```

Compared with HippoRAG 2, SAG achieves clear recall improvements on multi-hop QA: **average Recall@2 improves from 68.14% to 79.30%, a gain of 11.16 percentage points, or about 16.4% relative improvement**. Higher Recall@2 means agents can hit key evidence earlier with less context, reducing token cost, latency, and distraction in multi-turn tasks.

![SAG benchmark summary](docs/assets/sag-benchmark-simple.png)

On MuSiQue Recall@5, SAG improves from HippoRAG 2's 65.13% to 80.04%; after switching to NV-Embed-v2, it further reaches 81.71%, showing that the gain mainly comes from the structure rather than only a stronger embedding model.

## What SAG Can Do

This project turns SAG into a local workbench that can run immediately. It is suitable for:

- Project document Q&A
- Personal knowledge base search
- RAG / agent prototype validation
- Document event and entity analysis
- MCP tool integration testing
- Search pipeline debugging and model-call inspection

Core features:

- **Project management**: each project has its own documents, conversations, graph, and MCP configuration.
- **Multi-document upload**: upload multiple Markdown / TXT files at once, with processing stages and progress.
- **Document processing results**: inspect chunks, events, entities, embedding data, keyword title search, event/entity type filters, and paginated browsing.
- **Conversational retrieval**: ask multi-turn questions over the current project, with streaming output and stop generation.
- **Source citations**: answers can show numbered citations; click a number to view the original chunk.
- **Search trace visualization**: the right panel shows SAG's internal retrieval steps and latency in real time.
- **Raw logs**: browser cache stores raw LLM / Embedding / Rerank requests and responses.
- **Knowledge graph**: explore ordinary event/entity graphs or lazily expand a white-canvas React Flow lineage workbench, with semantic task/table/field nodes, five relation-family visibility controls, directional edges, and 1-5-hop focused subgraphs.
- **MCP integration**: each project exposes its own MCP configuration so external agents can call the current project directly.

## Tech Stack

SAG uses TypeScript across the stack. The frontend is a React + Vite + Tailwind CSS WebUI; typed lineage uses a lazily loaded React Flow canvas with ELK layered layout. The backend uses Fastify HTTP APIs, the MCP TypeScript SDK, and layered service modules. The data layer uses PostgreSQL, pgvector, full-text search, and SQL multi-hop queries. Model providers are OpenAI-compatible LLM, Embedding, and Rerank APIs.

## Workbench Preview

### Document Processing

In the Document tab, you can upload documents, inspect processing status, chunks, events, entities, and embeddings.

![SAG document view](docs/assets/sag-documents.png)

### Graph Exploration

In the Graph tab, ordinary projects retain the entity-event view. Typed lineage projects use a white 2D task/table/column workbench with search, click-to-focus, 1-5-hop upstream/downstream traversal, incremental expansion, details, fit-to-view, type colors, and independent controls for task-task/task-table/table-table/table-column/column-column relations. Fields are grouped into their owning table cards through explicit `HAS_COLUMN` relations. Selecting an entity lays out only the active traversal subgraph until the selection is cleared.

![SAG graph view](docs/assets/sag-graph.png)

The local visual smoke test can be repeated against a running server with `npm run verify:lineage-ui`; it checks document type filters, task dependencies, one/two-hop traversal, semantic table/field nodes, directional arrows, white-canvas pixels, controls, and desktop/mobile overflow.

### Conversational Retrieval

In the Chat tab, you can ask continuous questions over the current project. Each retrieval refreshes the right-side trace panel for debugging the current call chain.

## Search Modes

SAG provides two modes:

- **Fast mode**: directly matches the query against the entity store using full-text / BM25 search, expands through SAG multi-hop retrieval, and finally uses `qwen3-rerank` to select top-k. This mode does not use an LLM to extract query entities or filter candidates, so it is much faster.
- **Standard mode**: uses an LLM to extract query entities, then runs SAG multi-route recall and LLM reranking. This is useful when you want to compare the higher-precision pipeline.

Both modes are more than ordinary vector search because both use SAG's event/entity index and SQL multi-hop expansion.

## Quick Start

### 1. Prepare the Environment

You need:

- Node.js 20 or later
- npm
- PostgreSQL
- pgvector

If you want the fastest setup, use Docker to start PostgreSQL.

### 2. Clone the Project

```bash
git clone https://github.com/Zleap-AI/SAG.git
cd SAG
```

### 3. Create the Config File

```bash
cp .env.example .env
```

`.env.example` already contains default values. For real usage, fill in your own LLM and Embedding API keys.

### 4. Start PostgreSQL

Using Docker:

```bash
docker compose up -d
```

If you do not want to use Docker, you can use Homebrew on macOS:

```bash
brew install postgresql@17 pgvector
brew services start postgresql@17

/opt/homebrew/opt/postgresql@17/bin/createdb sag_lite
/opt/homebrew/opt/postgresql@17/bin/psql -d sag_lite -c 'create extension if not exists vector;'
```

If you use a local PostgreSQL instance, update `DATABASE_URL` in `.env`, for example:

```env
DATABASE_URL=postgres://your_user@localhost:5432/sag_lite
```

### 5. Install Dependencies and Initialize the Database

```bash
npm install
npm run db:setup
```

### 6. Start the Development Server

```bash
npm run dev
```

Default development URLs:

```text
WebUI: http://localhost:5173
API:   http://localhost:4173
```

### 7. Build and Start Production

```bash
npm run build
npm start
```

Default production URL:

```text
http://localhost:4173
```

## First Use

1. Open the WebUI.
2. Click "New Project" at the top of the left project list.
3. Go to the Document tab and click "Add Document".
4. Upload `.md` or `.txt` files.
5. Wait for the processing queue to finish.
6. Inspect chunks, events, entities, and embedding status.
7. Return to the Chat tab and ask questions over the current project.
8. For debugging, inspect the right-side Search Trace and Raw Logs.
9. For relationship exploration, open the Graph tab.
10. For external agents, open the MCP tab and copy the current project's configuration.

## Configure LLM and Embedding

SAG supports OpenAI-compatible APIs. Default example:

```env
EMBEDDING_BASE_URL=https://api.302ai.cn/v1
EMBEDDING_MODEL=text-embedding-3-large
EMBEDDING_DIMENSIONS=1024

LLM_BASE_URL=https://api.302ai.cn/v1
LLM_MODEL=qwen3.6-flash

RERANK_MODEL=qwen3-rerank
DEFAULT_SEARCH_MODE=fast
```

You can configure models in two ways:

### Option 1: WebUI Global Settings

Click the settings icon at the top of the left sidebar, open Global Settings, and fill in provider, model names, and API keys.

API keys only show as "Configured / Not configured". Plaintext keys are not echoed in the UI or API responses.

### Option 2: `.env`

```env
EMBEDDING_API_KEY=your_embedding_key
LLM_API_KEY=your_llm_key
RERANK_BASE_URL=https://api.your-provider.com/v1/rerank
```

By default, rerank requests use `LLM_BASE_URL` and append `/reranks`, for example `https://api.302ai.cn/v1/reranks`. Set `RERANK_BASE_URL` only when your provider needs a different full endpoint such as `/v1/rerank`.

If no API key is configured, the system uses a local deterministic fallback. This is useful for tests and UI inspection, but real retrieval quality requires remote models.

## MCP Integration

SAG can act as an MCP Server for external agents. Each project's MCP configuration binds the current project ID, so tool calls do not need to pass `projectId`.

Open the MCP tab in the WebUI to see the auto-generated `mcpServers` JSON for the current project. It looks like this:

```json
{
  "mcpServers": {
    "sag": {
      "command": "npm",
      "args": ["run", "mcp"],
      "env": {
        "SAG_MCP_SOURCE_ID": "current_project_id"
      }
    }
  }
}
```

Available MCP tools:

- `sag_ingest_document`: import a document and run chunking, event extraction, entity extraction, and vectorization.
- `sag_search`: run SAG multi-route retrieval on the current project and return the internal trace.
- `sag_explain_search`: return the current project's retrieval pipeline explanation and trace.
- `sag_get_event`: query event details by event ID.

## HTTP API Examples

Health check:

```bash
curl http://localhost:4173/health
```

Create a project:

```bash
curl -X POST http://localhost:4173/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo Project"}'
```

Ingest a document:

```bash
curl -X POST http://localhost:4173/ingest \
  -H 'Content-Type: application/json' \
  -d '{"sourceId":"project_id","title":"Demo","content":"# Demo\n\nSAG can search project documents.","extract":true}'
```

Run search:

```bash
curl -X POST http://localhost:4173/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"Why is SAG suitable for multi-hop retrieval?","sourceIds":["project_id"],"strategy":"multi","searchMode":"fast","topK":5,"returnTrace":true}'
```

Stream search trace:

```bash
curl -N -X POST http://localhost:4173/api/search/stream \
  -H 'Content-Type: application/json' \
  -d '{"query":"Explain SAG event/entity indexing","sourceIds":["project_id"],"strategy":"multi","returnTrace":true}'
```

## Common Commands

```bash
# Type check
npm run typecheck

# Run tests
npm test

# Build production assets
npm run build

# Start production server
npm start

# Start MCP stdio server
npm run mcp
```

## Project Structure

```text
src/
  ai/                 LLM, Embedding, and Rerank clients
  api/                HTTP API
  config/             Environment configuration
  db/                 Database connection, migrations, repositories, vector tools
  ingestion/          Document chunking and event extraction
  mcp/                MCP Server
  observability/      Logs and model-call records
  services/           Document processing, search, graph, and WebUI services

web/
  src/                React WebUI

migrations/           PostgreSQL schema
test/                 Unit tests
docs/assets/          README screenshots and diagrams
```

The SQL-specific architecture comparison with GitNexus and codegraph is documented in [SQL CodeGraph architecture assessment](docs/sql-codegraph-architecture-assessment.md).

## FAQ

### PostgreSQL Connection Failed

First confirm that the database is running:

```bash
docker compose ps
```

Then confirm that `DATABASE_URL` in `.env` is correct.

### pgvector Is Missing

Make sure pgvector is installed and run:

```sql
create extension if not exists vector;
```

If you use `docker compose up -d`, the image already includes pgvector.

### Why Do I Not See Real Model Quality?

If `LLM_API_KEY` and `EMBEDDING_API_KEY` are not configured, the system enters local fallback mode. This is useful for testing, but it is not suitable for judging real retrieval quality.

### Document Processing Is Slow

Document processing calls Embedding and LLM APIs. Speed mainly depends on document count, chunk count, model API latency, and concurrency settings. You can tune this in `.env`:

```env
INGEST_CONCURRENCY=5
```

### The Port Is Already in Use

In development mode, update `.env`:

```env
HTTP_PORT=4173
```

The Vite WebUI uses `5173` by default. If the port is occupied, Vite will show the new address automatically.

## License

MIT License. See [LICENSE](LICENSE).
