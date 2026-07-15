import type pg from "pg";
import { pool } from "./pool.js";
import type {
  LineageEvidenceEdge,
  LineageEvidenceEvent,
  LineageEvidenceNode,
  LineageEvidenceSnapshot,
  LineageRole
} from "../lineage/contracts.js";
import { computeGraphRevision } from "../lineage/revision.js";

type ReadClient = Pick<pg.PoolClient, "query">;

interface LineageSnapshotInput {
  sourceId: string;
  tenantId: string;
}

export async function getLineageEvidenceSnapshot(
  input: LineageSnapshotInput
): Promise<LineageEvidenceSnapshot | null> {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");

    if (!await hasActiveProject(client, input)) {
      await client.query("commit");
      return null;
    }

    const nodeRows = await loadLineageNodes(client, input);
    const edgeRows = await loadLineageEdges(client, input);
    const nodes = nodeRows.map(lineageNodeFromRow).sort(compareById);
    const edges = edgeRows.map(lineageEdgeFromRow).sort(compareById);
    const snapshot: LineageEvidenceSnapshot = {
      tenantId: input.tenantId,
      projectId: input.sourceId,
      available: edges.length > 0,
      graphRevision: "",
      nodes,
      edges
    };
    snapshot.graphRevision = computeGraphRevision(snapshot);

    await client.query("commit");
    return snapshot;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function hasActiveProject(
  client: ReadClient,
  input: LineageSnapshotInput
): Promise<boolean> {
  const result = await client.query(
    `
      select s.id
      from sources s
      where s.id = $1
        and s.tenant_id = $2
        and s.archived_at is null
      limit 1
    `,
    [input.sourceId, input.tenantId]
  );
  return result.rows.length > 0;
}

async function loadLineageNodes(
  client: ReadClient,
  input: LineageSnapshotInput
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
      with active_relations as (
        select
          lr.id,
          lr.source_entity_id,
          lr.target_entity_id,
          lr.context_task_entity_id
        from lineage_relations lr
        join events e
          on e.id = lr.event_id
         and e.source_id = lr.source_id
        join documents d
          on d.id = e.document_id
         and d.source_id = lr.source_id
        join sources s on s.id = lr.source_id
        join entities source_ent
          on source_ent.id = lr.source_entity_id
         and source_ent.source_id = lr.source_id
        join entities target_ent
          on target_ent.id = lr.target_entity_id
         and target_ent.source_id = lr.source_id
        where lr.source_id = $1
          and s.tenant_id = $2
          and s.archived_at is null
          and d.archived_at is null
          and e.deleted_at is null
      ),
      active_node_relations as (
        select id, source_entity_id as entity_id from active_relations
        union all
        select id, target_entity_id as entity_id from active_relations
        union all
        select id, context_task_entity_id as entity_id
        from active_relations
        where context_task_entity_id is not null
      )
      select
        ent.id,
        ent.source_id,
        ent.type,
        ent.name,
        ent.normalized_name,
        ent.metadata as entity_metadata,
        count(distinct active.id)::int as relation_count
      from active_node_relations active
      join entities ent
        on ent.id = active.entity_id
       and ent.source_id = $1
      group by ent.id
      order by ent.id
    `,
    [input.sourceId, input.tenantId]
  );
  return result.rows as Record<string, unknown>[];
}

async function loadLineageEdges(
  client: ReadClient,
  input: LineageSnapshotInput
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
      select
        lr.id::text as id,
        lr.source_entity_id,
        lr.target_entity_id,
        lr.relation_type,
        context_ent.id as context_task_entity_id,
        context_ent.name as context_task_name,
        e.id::text as event_id,
        e.title as event_title,
        e.summary as event_summary,
        e.metadata as event_metadata
      from lineage_relations lr
      join events e
        on e.id = lr.event_id
       and e.source_id = lr.source_id
      join documents d
        on d.id = e.document_id
       and d.source_id = lr.source_id
      join sources s on s.id = lr.source_id
      join entities source_ent
        on source_ent.id = lr.source_entity_id
       and source_ent.source_id = lr.source_id
      join entities target_ent
        on target_ent.id = lr.target_entity_id
       and target_ent.source_id = lr.source_id
      left join entities context_ent
        on context_ent.id = lr.context_task_entity_id
       and context_ent.source_id = lr.source_id
      where lr.source_id = $1
        and s.tenant_id = $2
        and s.archived_at is null
        and d.archived_at is null
        and e.deleted_at is null
      order by lr.id, e.id
    `,
    [input.sourceId, input.tenantId]
  );
  return result.rows as Record<string, unknown>[];
}

function lineageNodeFromRow(row: Record<string, unknown>): LineageEvidenceNode {
  const semantics = lineageRoleFromMetadata(row.entity_metadata);
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    type: String(row.type) as LineageEvidenceNode["type"],
    name: String(row.name),
    normalizedName: String(row.normalized_name),
    relationCount: Number(row.relation_count ?? 0),
    ...semantics
  };
}

function lineageEdgeFromRow(row: Record<string, unknown>): LineageEvidenceEdge {
  const event = lineageEventFromRow(row);
  return {
    id: String(row.id),
    sourceId: String(row.source_entity_id),
    targetId: String(row.target_entity_id),
    type: String(row.relation_type),
    contextTaskId: row.context_task_entity_id == null
      ? null
      : String(row.context_task_entity_id),
    contextTaskName: row.context_task_name == null
      ? null
      : String(row.context_task_name),
    eventId: event.id,
    eventIds: [event.id],
    evidenceCount: 1,
    events: [event]
  };
}

function lineageEventFromRow(row: Record<string, unknown>): LineageEvidenceEvent {
  const eventMetadata = objectValue(row.event_metadata);
  const evidence = objectValue(eventMetadata.sqlLineageEvidence);
  return {
    id: String(row.event_id),
    title: String(row.event_title ?? ""),
    summary: String(row.event_summary ?? ""),
    relativePath: stringValue(evidence.relativePath),
    statementId: stringValue(evidence.statementId)
  };
}

function lineageRoleFromMetadata(value: unknown): Pick<
  LineageEvidenceNode,
  "role" | "roleSource"
> {
  const metadata = objectValue(value);
  const semantics = objectValue(metadata.lineageSemantics);
  if (isLineageRole(semantics.role)) {
    return { role: semantics.role, roleSource: "declared" };
  }
  return { role: "business", roleSource: "legacy-default" };
}

function isLineageRole(value: unknown): value is LineageRole {
  return value === "business" || value === "temporary" || value === "evidence_only";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
