import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildHttpServer } from "../src/api/server.js";
import { mcpAgentService } from "../src/services/mcp-agent-service.js";
import { webuiService } from "../src/services/webui-service.js";
import type { LineageGraphRecord } from "../src/lineage/contracts.js";

const projectId = "00000000-0000-0000-0000-000000000001";
const graph: LineageGraphRecord = {
  available: true,
  view: "answer",
  graphRevision: `sagrev:${"a".repeat(64)}`,
  nodes: [],
  edges: [],
  evidencePathSummaries: [],
  stats: {
    evidenceLoadedNodes: 0,
    evidenceLoadedEdges: 0,
    answerNodes: 0,
    answerEdges: 0,
    semanticHiddenNodes: 0,
    semanticHiddenEdges: 0
  },
  hasMore: false
};
const app = buildHttpServer();

afterEach(() => vi.restoreAllMocks());
afterAll(async () => app.close());

describe("answer-safe lineage HTTP API", () => {
  it("defaults lineage graph requests to answer view", async () => {
    const getGraph = vi.spyOn(webuiService, "getLineageGraph").mockResolvedValue(graph);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/lineage-graph`
    });

    expect(response.statusCode).toBe(200);
    expect(getGraph).toHaveBeenCalledWith(projectId, {
      view: "answer",
      limit: 100
    });
    expect(response.json().graph.view).toBe("answer");
  });

  it("passes an explicit evidence view without silently discarding it", async () => {
    const evidence = { ...graph, view: "evidence" as const };
    const getGraph = vi.spyOn(webuiService, "getLineageGraph").mockResolvedValue(evidence);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/lineage-graph?view=evidence`
    });

    expect(response.statusCode).toBe(200);
    expect(getGraph).toHaveBeenCalledWith(projectId, {
      view: "evidence",
      limit: 100
    });
  });

  it("loads an explicitly requested evidence path through a dedicated route", async () => {
    const pathId = `sagpath:${"a".repeat(64)}:${"b".repeat(64)}`;
    const detail = {
      pathId,
      graphRevision: graph.graphRevision,
      nodes: [],
      edges: [],
      events: []
    };
    const getPath = vi.spyOn(webuiService, "getLineageEvidencePath").mockResolvedValue(detail);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/lineage-evidence-paths/${encodeURIComponent(pathId)}`
    });

    expect(response.statusCode).toBe(200);
    expect(getPath).toHaveBeenCalledWith(projectId, pathId);
    expect(response.json()).toEqual({ path: detail });
  });

  it("rejects unknown lineage query fields", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/lineage-graph?unsafe=true`
    });

    expect(response.statusCode).toBe(400);
  });

  it("does not expose unknown HTTP error messages", async () => {
    const secret = "postgres://user:secret@db/internal";
    vi.spyOn(webuiService, "getProjectGraph").mockRejectedValue(new Error(secret));

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/graph`
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(secret);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" }
    });
  });

  it("does not expose unknown SSE error messages", async () => {
    const secret = "SECRET_TMP_FROM_INTERNAL_ERROR";
    vi.spyOn(mcpAgentService, "runUserMessage").mockRejectedValue(new Error(secret));

    const response = await app.inject({
      method: "POST",
      url: "/api/mcp/sessions/00000000-0000-0000-0000-000000000010/messages/stream",
      payload: { content: "trace lineage" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
    expect(response.body).toContain("服务暂时不可用");
  });
});
