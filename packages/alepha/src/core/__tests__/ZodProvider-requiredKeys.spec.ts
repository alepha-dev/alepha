import { describe, expect, it } from "vitest";

import { z } from "../providers/ZodProvider.ts";

/**
 * `requiredKeys` answers one question: which keys must a caller supply for the
 * object to parse. It used to answer a narrower one - "which keys are not a
 * `ZodOptional`" - which reported every defaulted field as required, so
 * `alepha gen env` annotated defaulted variables "(required)" and forms marked
 * them with an asterisk and refused to submit them empty.
 */
describe("z.schema.requiredKeys", () => {
  it("should require a bare field", () => {
    const schema = z.object({ name: z.string() });

    expect(z.schema.requiredKeys(schema)).toEqual(["name"]);
  });

  it("should not require an optional field", () => {
    const schema = z.object({ name: z.string().optional() });

    expect(z.schema.requiredKeys(schema)).toEqual([]);
  });

  it("should not require a defaulted field", () => {
    const schema = z.object({ name: z.string().default("x") });

    expect(z.schema.requiredKeys(schema)).toEqual([]);
  });

  // `null` is a value, and the key still has to be there to carry it: parsing
  // `{}` against a plain `.nullable()` fails.
  it("should require a nullable field", () => {
    const schema = z.object({ name: z.string().nullable() });

    expect(z.schema.requiredKeys(schema)).toEqual(["name"]);
    expect(() => schema.parse({})).toThrow();
    expect(schema.parse({ name: null })).toEqual({ name: null });
  });

  it("should peel the wrappers in either order", () => {
    const schema = z.object({
      a: z.string().optional().nullable(),
      b: z.string().nullable().optional(),
      c: z.string().default("x").optional(),
      d: z.string().nullable().default("x"),
    });

    expect(z.schema.requiredKeys(schema)).toEqual([]);
  });

  it("should agree with what the schema actually accepts", () => {
    const schema = z.object({
      bare: z.string(),
      optional: z.string().optional(),
      defaulted: z.string().default("x"),
      nullable: z.string().nullable(),
      optionalNullable: z.string().optional().nullable(),
    });

    // Every key the helper leaves out can be omitted, and every key it keeps
    // cannot: that is the whole contract, so it is asserted rather than
    // described.
    const required = z.schema.requiredKeys(schema);
    for (const key of Object.keys(z.schema.shape(schema))) {
      const value = { bare: "a", nullable: null } as Record<string, unknown>;
      delete value[key];
      const omittable = schema.safeParse(value).success;
      expect([key, omittable]).toEqual([key, !required.includes(key)]);
    }
  });

  it("should return an empty array for a non-object", () => {
    expect(z.schema.requiredKeys(z.string())).toEqual([]);
    expect(z.schema.requiredKeys(undefined)).toEqual([]);
  });
});
