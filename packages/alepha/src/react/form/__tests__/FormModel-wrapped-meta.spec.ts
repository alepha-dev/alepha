import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { describe, it } from "vitest";

import { FormModel } from "../services/FormModel.ts";
import { parseField } from "../services/parseField.ts";

/**
 * `.meta()` binds to ONE schema instance, and `.optional()` / `.default()` each
 * return a new one, so an annotation written after a wrapper sits on the
 * wrapper. `FormModel` peels those wrappers before handing the schema to the
 * control, and used to drop their annotations with them: every knob in
 * `apps/ui` is spelled `.default(x).meta({ title })` and every one of them
 * rendered its prettified property name instead ("Item Count" for a field
 * titled "How many items"), silently and on a screen nobody reads twice.
 */
describe("FormModel meta on wrapped fields", () => {
  const schema = z.object({
    plain: z.string().meta({ title: "Plain" }),
    metaFirst: z.enum(["a", "b"]).meta({ title: "Meta first" }).default("a"),
    metaLast: z.enum(["a", "b"]).default("a").meta({ title: "Meta last" }),
    optionalLast: z.string().optional().meta({ title: "Optional last" }),
    stacked: z
      .string()
      .meta({ title: "Stacked" })
      .default("x")
      .optional()
      .nullable(),
    described: z
      .string()
      .default("x")
      .meta({ title: "Described", description: "Help text" }),
    untitled: z.string().default("x"),
  });

  const create = async () => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    return alepha.inject(FormModel as any, {
      lifetime: "transient",
      args: ["f1", { id: "f1", schema, handler: () => {} }],
    }) as FormModel<any>;
  };

  const labelOf = async (name: string) => {
    const form = await create();
    return parseField((form.input as any)[name]).label;
  };

  it("should label an unwrapped field", async ({ expect }) => {
    expect(await labelOf("plain")).toBe("Plain");
  });

  it("should label a field annotated before .default()", async ({ expect }) => {
    expect(await labelOf("metaFirst")).toBe("Meta first");
  });

  it("should label a field annotated after .default()", async ({ expect }) => {
    expect(await labelOf("metaLast")).toBe("Meta last");
  });

  it("should label a field annotated after .optional()", async ({ expect }) => {
    expect(await labelOf("optionalLast")).toBe("Optional last");
  });

  it("should label a field under a stack of wrappers", async ({ expect }) => {
    expect(await labelOf("stacked")).toBe("Stacked");
  });

  it("should carry the description across the wrapper too", async ({
    expect,
  }) => {
    const form = await create();

    expect(parseField((form.input as any).described).description).toBe(
      "Help text",
    );
  });

  it("should still fall back to the property name when untitled", async ({
    expect,
  }) => {
    expect(await labelOf("untitled")).toBe("Untitled");
  });

  it("should keep the wrapper's default working", async ({ expect }) => {
    const form = await create();

    expect(form.currentValues).toMatchObject({
      metaLast: "a",
      described: "x",
      untitled: "x",
    });
  });
});
