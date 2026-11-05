import { z } from "alepha";
import { describe, it } from "vitest";
import * as mini from "zod/mini";

const user = z.object({
  id: z.integer(),
  name: z.text(),
  email: z.text().optional(),
});

/**
 * `z.object` compiles its parser on the server, like classic zod does, and
 * must stay the object every other part of Alepha recognises.
 */
describe("z.object (compiled)", () => {
  it("parses like mini's object: strips unknown keys, applies transforms", ({
    expect,
  }) => {
    expect(user.parse({ id: 1, name: "  Ada  ", extra: true })).toEqual({
      id: 1,
      name: "Ada",
    });
  });

  it("reports the same issue as mini's object", ({ expect }) => {
    const shape = { id: z.integer(), name: z.text() };
    const compiled = z.object(shape).safeParse({ id: "1", name: 2 });
    const interpreted = mini
      .object(shape as any)
      .safeParse({ id: "1", name: 2 });

    expect(compiled.success).toBe(false);
    expect(compiled.error?.issues).toEqual(interpreted.error?.issues);
  });

  it("is still a ZodMiniObject, with its shape and chain methods", ({
    expect,
  }) => {
    expect(user).toBeInstanceOf(mini.ZodMiniObject as any);
    expect(z.schema.isObject(user)).toBe(true);
    expect(Object.keys(user.shape)).toEqual(["id", "name", "email"]);
    expect(user.optional().parse(undefined)).toBeUndefined();
  });

  it("keeps compiling in the schemas derived from it", ({ expect }) => {
    const picked = user.pick({ id: true });
    const extended = user.extend({ age: z.integer() });

    expect(picked._zod.traits.has("$ZodObjectJIT")).toBe(true);
    expect(extended._zod.traits.has("$ZodObjectJIT")).toBe(true);
    expect(picked.parse({ id: 2, name: "dropped" })).toEqual({ id: 2 });
    expect(() => extended.parse({ id: 2, name: "Ada" })).toThrow();
  });

  it("parses nested objects and arrays of them", ({ expect }) => {
    const list = z.array(z.object({ user, tags: z.array(z.text()) }));
    expect(
      list.parse([{ user: { id: 1, name: "a", x: 1 }, tags: [" t "] }]),
    ).toEqual([{ user: { id: 1, name: "a" }, tags: ["t"] }]);
  });
});
