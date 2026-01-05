import { t } from "alepha";
import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Current config response schema.
 */
export const configCurrentResponseSchema = t.object({
  current: t.optional(parameterResponseSchema),
  next: t.optional(parameterResponseSchema),
  defaultValue: t.optional(t.json()),
  currentValue: t.optional(t.json()),
  schema: t.optional(t.json()),
});
