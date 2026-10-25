import { type Infer, z } from "alepha";

/**
 * A tagged JSON object because the ORM does not map a top-level union column.
 * The refinement preserves the native type required by each discriminant.
 */
export const automationVariableValueSchema = z
  .object({
    kind: z.enum(["release", "member", "channel", "folio", "number", "text"]),
    value: z.union([
      z.string().max(16_384),
      z.number().finite().min(-1e12).max(1e12),
    ]),
  })
  .strict()
  .refine(
    ({ kind, value }) => {
      if (kind === "release")
        return (
          typeof value === "number" && Number.isSafeInteger(value) && value > 0
        );
      if (kind === "number") return typeof value === "number";
      if (typeof value !== "string") return false;
      if (kind === "member" || kind === "folio")
        return z.uuid().safeParse(value).success;
      if (kind === "channel") return value.length > 0 && value.length <= 32;
      return true;
    },
    { message: "Variable value does not match its declared kind" },
  );

export type AutomationVariableValue = Infer<
  typeof automationVariableValueSchema
>;
