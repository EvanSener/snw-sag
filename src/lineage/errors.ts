export type LineageErrorCode =
  | "INVALID_LINEAGE_PATH_ID"
  | "LINEAGE_GRAPH_NOT_FOUND"
  | "LINEAGE_PATH_NOT_FOUND"
  | "LINEAGE_REVISION_STALE"
  | "LINEAGE_REVISION_UNSTABLE";

export class LineageError extends Error {
  constructor(
    public readonly code: LineageErrorCode,
    public readonly statusCode: 400 | 404 | 409 | 503,
    message: string
  ) {
    super(message);
    this.name = "LineageError";
  }
}

export function invalidLineagePathId(): LineageError {
  return new LineageError("INVALID_LINEAGE_PATH_ID", 400, "血缘证据路径标识无效");
}

export function lineageGraphNotFound(): LineageError {
  return new LineageError("LINEAGE_GRAPH_NOT_FOUND", 404, "血缘图不存在");
}

export function lineagePathNotFound(): LineageError {
  return new LineageError("LINEAGE_PATH_NOT_FOUND", 404, "血缘证据路径不存在");
}

export function lineageRevisionStale(): LineageError {
  return new LineageError("LINEAGE_REVISION_STALE", 409, "血缘图已更新，请重新查询");
}

export function lineageRevisionUnstable(): LineageError {
  return new LineageError(
    "LINEAGE_REVISION_UNSTABLE",
    503,
    "血缘图在处理期间持续变化，请重试"
  );
}
