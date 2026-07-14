import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("lineage relations migration", () => {
  it("creates indexed typed relation storage", () => {
    const sql = fs.readFileSync("migrations/008_lineage_relations.sql", "utf8");

    expect(sql).toContain("create table if not exists lineage_relations");
    expect(sql).toContain("context_task_entity_id");
    expect(sql).toContain("lineage_relations_source_entity_idx");
    expect(sql).toContain("lineage_relations_target_entity_idx");
    expect(sql).toContain("lineage_relations_context_task_idx");
  });
});
