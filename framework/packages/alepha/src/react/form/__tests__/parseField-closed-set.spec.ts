import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { describe, it } from "vitest";

import { FormModel } from "../services/FormModel.ts";
import { parseField } from "../services/parseField.ts";

/**
 * A string with a closed set of values renders as a select (#Q3425), whether
 * it is written as `z.enum` or as a union of string literals. The realm's
 * email and username requirements were literal unions and rendered as free
 * text boxes in Admin > Parameters, so any value could be typed.
 */
describe("parseField on a closed set of strings", () => {
  const schema = z.object({
    asEnum: z.enum(["none", "optional", "required"]),
    asLiterals: z.union([
      z.literal("none"),
      z.literal("optional"),
      z.literal("email"),
    ]),
    optionalLiterals: z
      .union([z.literal("a"), z.literal("b")])
      .optional(),
    mixed: z.union([z.literal("a"), z.string()]),
    numbers: z.union([z.literal(1), z.literal(2)]),
    free: z.string(),
  });

  const fields = async () => {
    const alepha = Alepha.create().with(AlephaLogger);
    await alepha.start();
    const form = alepha.inject(FormModel, {
      lifetime: "transient",
      args: ["f1", { id: "f1", schema, handler: () => {} }],
    }) as FormModel<any>;
    return (name: string) => parseField(form.input[name]);
  };

  it("offers an enum's values", async ({ expect }) => {
    const field = await fields();
    expect(field("asEnum").isEnum).toBe(true);
    expect(field("asEnum").enum).toEqual(["none", "optional", "required"]);
  });

  it("offers a union of string literals the same way", async ({ expect }) => {
    const field = await fields();
    expect(field("asLiterals").isEnum).toBe(true);
    expect(field("asLiterals").type).toBe("string");
    expect(field("asLiterals").enum).toEqual(["none", "optional", "email"]);
    expect(field("optionalLiterals").enum).toEqual(["a", "b"]);
  });

  it("keeps a union that is not a closed set of strings a free field", async ({
    expect,
  }) => {
    const field = await fields();
    expect(field("mixed").isEnum).toBe(false);
    expect(field("numbers").isEnum).toBe(false);
    expect(field("free").isEnum).toBe(false);
  });
});
