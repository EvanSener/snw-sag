import { afterAll, describe, expect, it } from "vitest";
import { buildHttpServer } from "../src/api/server.js";

const app = buildHttpServer();

afterAll(async () => {
  await app.close();
});

describe.each([
  "/api/documents/upload",
  "/api/documents/upload/jobs"
])("%s body limit", (url) => {
  it("parses a document payload larger than Fastify's 1 MiB default", async () => {
    const response = await app.inject({
      method: "POST",
      url,
      payload: {
        fileName: "large.invalid",
        content: "x".repeat(1_100_000)
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: {
        message: "只支持上传 .md 和 .txt 文档"
      }
    });
  });
});
