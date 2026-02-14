import { describe, it } from "vitest";
import { DefinitionsPool } from "./DefinitionsPool.ts";

describe("DefinitionsPool", () => {
  it("should assign $N keys to unique schemas", ({ expect }) => {
    const pool = new DefinitionsPool();

    const ref0 = pool.ref({
      type: "object",
      properties: { id: { type: "string" } },
    });
    const ref1 = pool.ref({
      type: "object",
      properties: { ok: { type: "boolean" } },
    });

    expect(ref0).toBe("$0");
    expect(ref1).toBe("$1");
    expect(pool.size).toBe(2);
  });

  it("should deduplicate identical schemas", ({ expect }) => {
    const pool = new DefinitionsPool();
    const schema = { type: "object", properties: { id: { type: "string" } } };

    const ref1 = pool.ref(schema);
    const ref2 = pool.ref(schema);
    const ref3 = pool.ref({ ...schema });

    expect(ref1).toBe("$0");
    expect(ref2).toBe("$0");
    expect(ref3).toBe("$0");
    expect(pool.size).toBe(1);
  });

  it("should return undefined for undefined/null schema", ({ expect }) => {
    const pool = new DefinitionsPool();

    expect(pool.ref(undefined)).toBeUndefined();
    expect(pool.size).toBe(0);
  });

  it("should distinguish schemas with different field order", ({ expect }) => {
    const pool = new DefinitionsPool();

    const ref1 = pool.ref({ a: 1, b: 2 });
    const ref2 = pool.ref({ b: 2, a: 1 });

    // JSON.stringify produces different strings for different key order
    expect(ref1).toBe("$0");
    expect(ref2).toBe("$1");
    expect(pool.size).toBe(2);
  });

  it("should produce correct toJSON output", ({ expect }) => {
    const pool = new DefinitionsPool();

    const schema1 = { type: "object", properties: { id: { type: "string" } } };
    const schema2 = { type: "boolean" };

    pool.ref(schema1);
    pool.ref(schema2);
    pool.ref(schema1); // duplicate — should not create new entry

    const json = pool.toJSON();

    expect(json).toEqual({
      $0: JSON.stringify(schema1),
      $1: JSON.stringify(schema2),
    });
  });

  it("should handle many schemas with correct counter", ({ expect }) => {
    const pool = new DefinitionsPool();

    for (let i = 0; i < 50; i++) {
      pool.ref({ index: i });
    }

    expect(pool.size).toBe(50);
    const json = pool.toJSON();
    expect(Object.keys(json)).toHaveLength(50);
    expect(json.$0).toBe(JSON.stringify({ index: 0 }));
    expect(json.$49).toBe(JSON.stringify({ index: 49 }));
  });
});
