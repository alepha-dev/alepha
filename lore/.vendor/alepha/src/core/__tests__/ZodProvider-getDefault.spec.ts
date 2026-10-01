import { describe, expect, it } from "vitest";

import { z } from "../providers/ZodProvider.ts";

/**
 * `getDefault` answers "what value does this schema stand in with". Two
 * sources: the ORM attaches a value as an own `default` property, and zod
 * carries one in a `ZodDefault` wrapper.
 *
 * The trap is that zod 4 installs its own `.default()` METHOD as an own
 * property the first time that method is called on a schema. So an
 * `Object.hasOwn(s, "default")` test alone reports true for any schema
 * somebody chained `.default()` on elsewhere, and hands back the function.
 */
describe("z.schema.getDefault", () => {
  it("reports no default for a plain schema", () => {
    expect(z.schema.getDefault(z.enum(["day", "week", "month"]))).toBe(
      undefined,
    );
  });

  it("reads a zod default", () => {
    expect(z.schema.getDefault(z.text().default("hello"))).toBe("hello");
  });

  it("peels optional and nullable to find a zod default", () => {
    expect(z.schema.getDefault(z.text().default("hello").optional())).toBe(
      "hello",
    );
  });

  it("reads a value attached as an own property", () => {
    const schema = z.text();
    Object.assign(schema, { default: "attached" });

    expect(z.schema.getDefault(schema)).toBe("attached");
  });

  it("does not read zod's own .default method as a default value", () => {
    // A schema shared between a settings atom, which chains `.default()`, and
    // an entity column, which does not. Calling the method leaves it behind
    // as an own property on the ORIGINAL schema (quest #Q341).
    const grain = z.enum(["day", "week", "month"]);
    void grain.default("month");
    expect(Object.hasOwn(grain, "default")).toBe(true);

    expect(z.schema.getDefault(grain)).toBe(undefined);
  });
});
