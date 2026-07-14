import { z } from "zod";
import type { ExtractedEntity, ExtractedEvent } from "../../types.js";

const structuredEventMarker = /```sag-event\b/;
const structuredEventBlock = /```sag-event[ \t]*\r?\n([\s\S]*?)\r?\n```/g;

const nonEmptyString = z.string().trim().min(1);
const structuredEntitySchema = z.object({
  type: z.enum(["task", "table", "column"]),
  name: nonEmptyString,
  description: nonEmptyString
}).strict();

const structuredEventEnvelopeSchema = z.object({
  schema: z.literal("snw.sql_lineage_event.v1"),
  title: nonEmptyString,
  summary: nonEmptyString,
  content: nonEmptyString,
  category: nonEmptyString,
  keywords: z.array(nonEmptyString),
  entities: z.array(structuredEntitySchema).min(1)
}).strict();

export function parseStructuredEvent(rawContent: string, references: string[]): ExtractedEvent | null {
  if (!structuredEventMarker.test(rawContent)) {
    return null;
  }

  const matches = [...rawContent.matchAll(structuredEventBlock)];
  if (matches.length !== 1) {
    throw invalidStructuredEvent(`expected exactly one sag-event block, received ${matches.length}`);
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(matches[0][1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw invalidStructuredEvent(`invalid JSON: ${message}`);
  }

  const result = structuredEventEnvelopeSchema.safeParse(candidate);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw invalidStructuredEvent(details);
  }

  const { schema: _schema, entities, ...event } = result.data;
  return {
    ...event,
    references,
    entities: dedupeEntities(entities)
  };
}

function dedupeEntities(entities: ExtractedEntity[]): ExtractedEntity[] {
  const unique = new Map<string, ExtractedEntity>();
  for (const entity of entities) {
    const key = `${entity.type}\u0000${entity.name.toLowerCase()}`;
    if (!unique.has(key)) {
      unique.set(key, entity);
    }
  }
  return [...unique.values()];
}

function invalidStructuredEvent(details: string): Error {
  return new Error(`Invalid structured SAG event: ${details}`);
}
