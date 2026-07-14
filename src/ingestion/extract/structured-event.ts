import { z } from "zod";
import type { ExtractedEntity, ExtractedEvent, ExtractedRelation } from "../../types.js";

const structuredEventMarker = /```sag-event\b/;
const structuredEventBlock = /```sag-event[ \t]*\r?\n([\s\S]*?)\r?\n```/g;

const nonEmptyString = z.string().trim().min(1);
const structuredEntitySchema = z.object({
  type: z.enum(["task", "table", "column"]),
  name: nonEmptyString,
  description: nonEmptyString
}).strict();

const eventFields = {
  title: nonEmptyString,
  summary: nonEmptyString,
  content: nonEmptyString,
  category: nonEmptyString,
  keywords: z.array(nonEmptyString),
  entities: z.array(structuredEntitySchema).min(1)
};

const structuredEntityRefSchema = z.object({
  type: z.enum(["task", "table", "column"]),
  name: nonEmptyString
}).strict();

const relationTypeSchema = z.enum([
  "PRODUCES",
  "DATA_FLOW",
  "LEFT_JOIN",
  "RIGHT_JOIN",
  "FULL_OUTER_JOIN",
  "INNER_JOIN",
  "CROSS_JOIN",
  "HAS_COLUMN",
  "SOURCE_FOR_COLUMN",
  "DIRECT_FROM",
  "DERIVED_FROM",
  "AGGREGATED_FROM",
  "CONDITIONAL_FROM",
  "WINDOWED_FROM"
]);

const structuredRelationSchema = z.object({
  source: structuredEntityRefSchema,
  type: relationTypeSchema,
  target: structuredEntityRefSchema,
  contextTask: nonEmptyString.optional()
}).strict();

const structuredEventV1Schema = z.object({
  schema: z.literal("snw.sql_lineage_event.v1"),
  ...eventFields
}).strict();

const structuredEventV2Schema = z.object({
  schema: z.literal("snw.sql_lineage_event.v2"),
  ...eventFields,
  relations: z.array(structuredRelationSchema).min(1)
}).strict();

const structuredEventEnvelopeSchema = z.discriminatedUnion("schema", [
  structuredEventV1Schema,
  structuredEventV2Schema
]);

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

  const entities = dedupeEntities(result.data.entities);
  if (result.data.schema === "snw.sql_lineage_event.v2") {
    validateRelations(entities, result.data.relations);
    const { schema: _schema, relations, ...event } = result.data;
    return {
      ...event,
      references,
      entities,
      relations: dedupeRelations(relations)
    };
  }

  const { schema: _schema, ...event } = result.data;
  return {
    ...event,
    references,
    entities
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

function validateRelations(entities: ExtractedEntity[], relations: ExtractedRelation[]): void {
  const declared = new Set(entities.map((entity) => entityKey(entity.type, entity.name)));
  const tasks = new Set(
    entities
      .filter((entity) => entity.type === "task")
      .map((entity) => normalizeName(entity.name))
  );

  for (const relation of relations) {
    if (!declared.has(entityKey(relation.source.type, relation.source.name))) {
      throw invalidStructuredEvent(`relation references undeclared entity ${relation.source.type}:${relation.source.name}`);
    }
    if (!declared.has(entityKey(relation.target.type, relation.target.name))) {
      throw invalidStructuredEvent(`relation references undeclared entity ${relation.target.type}:${relation.target.name}`);
    }
    if (relation.contextTask && !tasks.has(normalizeName(relation.contextTask))) {
      throw invalidStructuredEvent(`relation contextTask references undeclared entity task:${relation.contextTask}`);
    }
    validateRelationShape(relation);
  }
}

function validateRelationShape(relation: ExtractedRelation): void {
  const joins = new Set(["LEFT_JOIN", "RIGHT_JOIN", "FULL_OUTER_JOIN", "INNER_JOIN", "CROSS_JOIN"]);
  const columnRelations = new Set([
    "DIRECT_FROM",
    "DERIVED_FROM",
    "AGGREGATED_FROM",
    "CONDITIONAL_FROM",
    "WINDOWED_FROM"
  ]);
  const endpoint = `${relation.source.type}->${relation.target.type}`;
  const expected = relation.type === "PRODUCES"
    ? "task->table"
    : relation.type === "DATA_FLOW" || joins.has(relation.type)
      ? "table->table"
      : relation.type === "HAS_COLUMN" || relation.type === "SOURCE_FOR_COLUMN"
        ? "table->column"
        : columnRelations.has(relation.type)
          ? "column->column"
          : "";
  if (endpoint !== expected) {
    throw invalidStructuredEvent(`relation ${relation.type} requires ${expected}, received ${endpoint}`);
  }
  const requiresContext = relation.type === "DATA_FLOW"
    || joins.has(relation.type)
    || relation.type === "SOURCE_FOR_COLUMN"
    || columnRelations.has(relation.type);
  if (requiresContext && !relation.contextTask) {
    throw invalidStructuredEvent(`relation ${relation.type} requires contextTask`);
  }
}

function dedupeRelations(relations: ExtractedRelation[]): ExtractedRelation[] {
  const unique = new Map<string, ExtractedRelation>();
  for (const relation of relations) {
    const key = [
      entityKey(relation.source.type, relation.source.name),
      relation.type,
      entityKey(relation.target.type, relation.target.name),
      normalizeName(relation.contextTask ?? "")
    ].join("\u0000");
    if (!unique.has(key)) {
      unique.set(key, relation);
    }
  }
  return [...unique.values()];
}

function entityKey(type: string, name: string): string {
  return `${type}\u0000${normalizeName(name)}`;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function invalidStructuredEvent(details: string): Error {
  return new Error(`Invalid structured SAG event: ${details}`);
}
