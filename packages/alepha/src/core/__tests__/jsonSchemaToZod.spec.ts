import { describe, expect, it } from "vitest";
import { jsonSchemaToZod } from "../helpers/jsonSchemaToZod.ts";
import { z } from "../providers/ZodProvider.ts";

describe("jsonSchemaToZod", () => {
  it("should convert an object schema with required and optional fields", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name"],
    });

    expect(schema.safeParse({ name: "a" }).success).toBe(true);
    expect(schema.safeParse({ name: "a", age: 3 }).success).toBe(true);
    expect(schema.safeParse({ age: 3 }).success).toBe(false);
    expect(schema.safeParse({ name: "a", age: 3.5 }).success).toBe(false);
  });

  it("should convert arrays with item schemas", () => {
    const schema = jsonSchemaToZod({
      type: "array",
      items: { type: "number" },
    });

    expect(schema.safeParse([1, 2.5]).success).toBe(true);
    expect(schema.safeParse(["a"]).success).toBe(false);
  });

  it("should apply string constraints", () => {
    const schema = jsonSchemaToZod({
      type: "string",
      minLength: 2,
      maxLength: 4,
      pattern: "^[a-z]+$",
    });

    expect(schema.safeParse("abc").success).toBe(true);
    expect(schema.safeParse("a").success).toBe(false);
    expect(schema.safeParse("abcde").success).toBe(false);
    expect(schema.safeParse("ABC").success).toBe(false);
  });

  it("should keep an unbounded string unbounded", () => {
    const schema = jsonSchemaToZod({ type: "string" });
    expect(schema.safeParse("x".repeat(100_000)).success).toBe(true);
  });

  it("should map string formats", () => {
    expect(
      jsonSchemaToZod({ type: "string", format: "uuid" }).safeParse(
        "8f14e45f-ceea-4467-a1b9-2f7f6a2c11aa",
      ).success,
    ).toBe(true);
    expect(
      jsonSchemaToZod({ type: "string", format: "uuid" }).safeParse("nope")
        .success,
    ).toBe(false);
    expect(
      jsonSchemaToZod({ type: "string", format: "email" }).safeParse("a@b.co")
        .success,
    ).toBe(true);
    expect(
      jsonSchemaToZod({ type: "string", format: "date-time" }).safeParse(
        "2026-01-01T10:00:00Z",
      ).success,
    ).toBe(true);
    expect(
      jsonSchemaToZod({ type: "string", format: "date" }).safeParse(
        "2026-01-01",
      ).success,
    ).toBe(true);
  });

  it("should convert enums of strings", () => {
    const schema = jsonSchemaToZod({ enum: ["a", "b"] });
    expect(schema.safeParse("a").success).toBe(true);
    expect(schema.safeParse("c").success).toBe(false);
  });

  it("should convert const to a literal", () => {
    const schema = jsonSchemaToZod({ const: "fixed" });
    expect(schema.safeParse("fixed").success).toBe(true);
    expect(schema.safeParse("other").success).toBe(false);
  });

  it("should convert anyOf with a null variant to nullable", () => {
    const schema = jsonSchemaToZod({
      anyOf: [{ type: "string" }, { type: "null" }],
    });

    expect(schema.safeParse("x").success).toBe(true);
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse(3).success).toBe(false);
  });

  it("should convert multi-variant anyOf to a union", () => {
    const schema = jsonSchemaToZod({
      anyOf: [{ type: "string" }, { type: "number" }],
    });

    expect(schema.safeParse("x").success).toBe(true);
    expect(schema.safeParse(3).success).toBe(true);
    expect(schema.safeParse(true).success).toBe(false);
  });

  it("should apply numeric bounds", () => {
    const schema = jsonSchemaToZod({
      type: "integer",
      minimum: 1,
      maximum: 5,
    });

    expect(schema.safeParse(3).success).toBe(true);
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(6).success).toBe(false);
    expect(schema.safeParse(2.5).success).toBe(false);
  });

  it("should fall back to z.any for unknown shapes", () => {
    expect(jsonSchemaToZod(undefined).safeParse("anything").success).toBe(true);
    expect(jsonSchemaToZod({}).safeParse({ a: 1 }).success).toBe(true);
    expect(
      jsonSchemaToZod({ type: "no-such-type" }).safeParse(42).success,
    ).toBe(true);
  });

  it("should carry title and description into meta", () => {
    const schema = jsonSchemaToZod({
      type: "string",
      title: "Name",
      description: "The display name",
    });

    expect(z.schema.meta(schema)).toMatchObject({
      title: "Name",
      description: "The display name",
    });
  });

  it("should round-trip a z.toJSONSchema export", () => {
    const original = z.object({
      id: z.uuid(),
      label: z.text(),
      count: z.integer().optional(),
    });

    const roundTripped = jsonSchemaToZod(z.toJSONSchema(original));

    const valid = {
      id: "8f14e45f-ceea-4467-a1b9-2f7f6a2c11aa",
      label: "hello",
    };
    expect(roundTripped.safeParse(valid).success).toBe(true);
    expect(roundTripped.safeParse({ label: "no-id" }).success).toBe(false);
  });
});
