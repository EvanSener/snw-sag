create table if not exists lineage_relations (
  id uuid primary key,
  source_id uuid not null references sources(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  source_entity_id uuid not null references entities(id) on delete cascade,
  target_entity_id uuid not null references entities(id) on delete cascade,
  relation_type text not null,
  context_task_entity_id uuid references entities(id) on delete cascade,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists lineage_relations_event_edge_unique_idx
  on lineage_relations (
    event_id,
    source_entity_id,
    target_entity_id,
    relation_type,
    coalesce(context_task_entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists lineage_relations_source_type_idx
  on lineage_relations (source_id, relation_type);
create index if not exists lineage_relations_source_entity_idx
  on lineage_relations (source_id, source_entity_id);
create index if not exists lineage_relations_target_entity_idx
  on lineage_relations (source_id, target_entity_id);
create index if not exists lineage_relations_context_task_idx
  on lineage_relations (source_id, context_task_entity_id)
  where context_task_entity_id is not null;
create index if not exists lineage_relations_event_idx
  on lineage_relations (event_id);
