import { describe, expect, it } from "vitest";
import { coerceObject, coerceScalar } from "../helpers/coerceStrings.ts";
import { z } from "../providers/ZodProvider.ts";

describe("coerceScalar", () => {
  it("should coerce numeric strings for number schemas", () => {
    expect(coerceScalar(z.integer(), "42")).toBe(42);
    expect(coerceScalar(z.number(), "3.14")).toBe(3.14);
  });

  it("should leave non-numeric strings for number schemas unchanged", () => {
    expect(coerceScalar(z.integer(), "abc")).toBe("abc");
    expect(coerceScalar(z.integer(), "")).toBe("");
    expect(coerceScalar(z.integer(), "  ")).toBe("  ");
  });

  it("should coerce boolean strings for boolean schemas", () => {
    expect(coerceScalar(z.boolean(), "true")).toBe(true);
    expect(coerceScalar(z.boolean(), "false")).toBe(false);
    expect(coerceScalar(z.boolean(), "yes")).toBe("yes");
  });

  it("should stringify typed scalars for string schemas", () => {
    expect(coerceScalar(z.text(), 3000)).toBe("3000");
    expect(coerceScalar(z.text(), true)).toBe("true");
  });

  it("should coerce through optional wrappers", () => {
    expect(coerceScalar(z.integer().optional(), "7")).toBe(7);
    expect(coerceScalar(z.boolean().optional(), "true")).toBe(true);
  });

  it("should coerce array elements", () => {
    expect(coerceScalar(z.array(z.integer()), ["1", "2"])).toEqual([1, 2]);
  });

  it("should pass through values it cannot coerce", () => {
    expect(coerceScalar(z.integer(), { a: 1 })).toEqual({ a: 1 });
    expect(coerceScalar(z.text(), null)).toBe(null);
  });
});

describe("coerceObject", () => {
  it("should coerce declared fields only", () => {
    const schema = z.object({
      PORT: z.integer(),
      DEBUG: z.boolean(),
    });

    const out = coerceObject(schema, {
      PORT: "3000",
      DEBUG: "true",
      EXTRA: "untouched",
    });

    expect(out.PORT).toBe(3000);
    expect(out.DEBUG).toBe(true);
    expect(out.EXTRA).toBe("untouched");
  });

  it("should parse a JSON object arriving as a string", () => {
    const schema = z.object({
      CONFIG: z.object({ project: z.string(), analytics: z.boolean() }),
    });

    const out = coerceObject(schema, {
      CONFIG: '{"project":"alepha","analytics":false}',
    });

    expect(out.CONFIG).toEqual({ project: "alepha", analytics: false });
  });

  /**
   * The contract this file states: what cannot be coerced is returned as it
   * came, so validation produces a rejection naming the field. A stray comma in
   * a dashboard textarea has to surface that way, not as an exception thrown
   * from a parser the caller never invoked.
   */
  it("should leave malformed JSON unchanged for validation to reject", () => {
    const schema = z.object({ CONFIG: z.object({ a: z.string() }) });
    const broken = '{"a":"b",}';

    expect(coerceObject(schema, { CONFIG: broken }).CONFIG).toBe(broken);
  });

  /**
   * `"null"`, `"7"` and `"true"` are all valid JSON documents. A schema
   * expecting an object should reject them as the wrong type, not receive one.
   */
  it("should not parse scalar JSON for an object schema", () => {
    const schema = z.object({ CONFIG: z.object({ a: z.string() }) });

    expect(coerceObject(schema, { CONFIG: "null" }).CONFIG).toBe("null");
    expect(coerceObject(schema, { CONFIG: "7" }).CONFIG).toBe("7");
    expect(coerceObject(schema, { CONFIG: "hello" }).CONFIG).toBe("hello");
  });

  /**
   * The shape every CI system produces for a secret that is not set:
   * `${{ secrets.MISSING }}` interpolates to the empty string. Reading it as
   * absent is what keeps deleting an optional variable from taking an app
   * down at boot, which is otherwise exactly what happens - the field is
   * optional, and `""` is the one value it can never satisfy.
   */
  it("should read an empty string as an absent structured value", () => {
    const schema = z.object({
      CONFIG: z.object({ a: z.string() }).optional(),
      PATHS: z.array(z.string()).optional(),
    });

    expect(coerceObject(schema, { CONFIG: "" }).CONFIG).toBeUndefined();
    expect(coerceObject(schema, { CONFIG: "   " }).CONFIG).toBeUndefined();
    expect(coerceObject(schema, { PATHS: "" }).PATHS).toBeUndefined();
  });

  it("should still reject an empty string for a REQUIRED structured field", () => {
    // Absent rather than malformed, so the error names the missing variable
    // instead of complaining about its type. Both are errors; this one reads.
    const schema = z.object({ CONFIG: z.object({ a: z.string() }) });

    expect(coerceObject(schema, { CONFIG: "" }).CONFIG).toBeUndefined();
  });

  it("should parse a JSON array arriving as a string", () => {
    const schema = z.object({ PATHS: z.array(z.string()) });

    expect(coerceObject(schema, { PATHS: '["/a","/b"]' }).PATHS).toEqual([
      "/a",
      "/b",
    ]);
  });

  it("should skip null and undefined values", () => {
    const schema = z.object({
      PORT: z.integer().optional(),
    });

    const out = coerceObject(schema, { PORT: undefined, OTHER: null });
    expect(out.PORT).toBeUndefined();
    expect(out.OTHER).toBeNull();
  });

  it("should not mutate the input object", () => {
    const schema = z.object({ PORT: z.integer() });
    const input = { PORT: "3000" };

    const out = coerceObject(schema, input);
    expect(input.PORT).toBe("3000");
    expect(out.PORT).toBe(3000);
  });

  it("should pass through when the schema has no shape", () => {
    const value = { A: "1" };
    expect(coerceObject(z.any(), value)).toBe(value);
  });
});
