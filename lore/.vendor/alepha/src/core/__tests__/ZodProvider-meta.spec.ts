import { describe, expect, it } from "vitest";

import { z } from "../providers/ZodProvider.ts";

/**
 * `.meta()` binds to ONE schema instance, and `.optional()` / `.nullable()` /
 * `.default()` each return a new one. So the same annotation lands on a
 * different object depending on where in the chain it was written, and reading
 * only one end of the chain loses half of them.
 *
 * That is not theoretical: every knob in `apps/ui` is written
 * `.default(x).meta({ title })`, and the forms rendered prettified property
 * names ("Item Count", "Rich") instead of the titles, silently.
 */
describe("z.schema.meta", () => {
  it("should read an annotation on a bare schema", () => {
    const schema = z.string().meta({ title: "Name" });

    expect(z.schema.meta(schema).title).toBe("Name");
  });

  it("should read an annotation written before .default()", () => {
    const schema = z.enum(["a", "b"]).meta({ title: "Letter" }).default("a");

    expect(z.schema.meta(schema).title).toBe("Letter");
  });

  it("should read an annotation written after .default()", () => {
    const schema = z.enum(["a", "b"]).default("a").meta({ title: "Letter" });

    expect(z.schema.meta(schema).title).toBe("Letter");
  });

  it("should read an annotation written after .optional()", () => {
    const schema = z.string().optional().meta({ title: "Nickname" });

    expect(z.schema.meta(schema).title).toBe("Nickname");
  });

  it("should read through a stack of wrappers", () => {
    const schema = z
      .string()
      .meta({ title: "Nickname" })
      .default("x")
      .optional()
      .nullable();

    expect(z.schema.meta(schema).title).toBe("Nickname");
  });

  it("should merge the layers rather than pick one", () => {
    const schema = z
      .string()
      .meta({ title: "Nickname" })
      .default("x")
      .meta({ description: "Shown in the header" });

    expect(z.schema.meta(schema)).toMatchObject({
      title: "Nickname",
      description: "Shown in the header",
    });
  });

  it("should let the outer layer win a contested key", () => {
    const schema = z.string().meta({ title: "Inner" }).default("x").meta({
      title: "Outer",
    });

    expect(z.schema.meta(schema).title).toBe("Outer");
  });

  it("should answer an empty object for an unannotated schema", () => {
    expect(z.schema.meta(z.string().optional())).toEqual({});
  });
});
