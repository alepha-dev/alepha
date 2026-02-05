import { type Static, t } from "alepha";
import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Current parameter response schema.
 * Includes current version, next scheduled version, and defaults.
 */
export const parameterCurrentResponseSchema = t.object({
  current: t.optional(parameterResponseSchema),
  next: t.optional(parameterResponseSchema),
  defaultValue: t.optional(t.json()),
  currentValue: t.optional(t.json()),
  schema: t.optional(t.json()),
});

export type ParameterCurrentResponse = Static<
  typeof parameterCurrentResponseSchema
>;
