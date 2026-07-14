import { describe, expect, it } from "vitest";
import { defaultEntityTypes } from "../src/db/seed.js";

describe("defaultEntityTypes", () => {
  it("registers the controlled SQL lineage entity types", () => {
    const sqlLineageTypes = defaultEntityTypes
      .map((item) => item.type)
      .filter((type) => ["task", "table", "column"].includes(type));

    expect(sqlLineageTypes).toEqual(["task", "table", "column"]);
  });
});
