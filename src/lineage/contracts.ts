import { z } from "zod";

const sha256Pattern = /^[0-9a-f]{64}$/;
const gitCommitPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function prefixedSha256Schema(prefix: "repo" | "file" | "stmt") {
  return z.string().regex(new RegExp(`^${prefix}:[0-9a-f]{64}$`));
}

export const lineageRoleSchema = z.enum(["business", "temporary", "evidence_only"]);
export type LineageRole = z.infer<typeof lineageRoleSchema>;

export const lineageSemanticsSchema = z.object({
  role: lineageRoleSchema
}).strict();
export type LineageSemantics = z.infer<typeof lineageSemanticsSchema>;

export const sourceSpanSchema = z.object({
  startByte: z.number().int().min(0),
  endByte: z.number().int().positive(),
  startLine: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().positive()
}).strict().superRefine((span, context) => {
  if (span.endByte <= span.startByte) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endByte"],
      message: "endByte must be greater than startByte"
    });
  }
  if (
    span.endLine < span.startLine
    || (span.endLine === span.startLine && span.endColumn < span.startColumn)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [span.endLine === span.startLine ? "endColumn" : "endLine"],
      message: "span end must not precede span start"
    });
  }
});
export type SourceSpan = z.infer<typeof sourceSpanSchema>;

export const sqlLineageEvidenceSchema = z.object({
  repositoryId: prefixedSha256Schema("repo"),
  fileId: prefixedSha256Schema("file"),
  statementId: prefixedSha256Schema("stmt"),
  relativePath: z.string().min(1).refine((value) => {
    const segments = value.split("/");
    return !value.startsWith("/")
      && !value.includes("\\")
      && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  }, "relativePath must be a normalized POSIX repository-relative path"),
  contentHash: z.string().regex(sha256Pattern),
  gitCommit: z.union([
    z.string().regex(gitCommitPattern),
    z.null()
  ]),
  dialect: z.string().trim().min(1),
  parserVersion: z.string().trim().min(1),
  span: sourceSpanSchema
}).strict();
export type SqlLineageEvidence = z.infer<typeof sqlLineageEvidenceSchema>;

export type SqlLineageEventSchema =
  | "snw.sql_lineage_event.v1"
  | "snw.sql_lineage_event.v2"
  | "snw.sql_lineage_event.v3";
