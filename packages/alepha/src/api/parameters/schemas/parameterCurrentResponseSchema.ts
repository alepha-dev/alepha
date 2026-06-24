import { type Static, z } from "alepha";
import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Current parameter response schema.
 * Includes current version, next scheduled version, and defaults.
 */
export const parameterCurrentResponseSchema = z.object({
  current: parameterResponseSchema.optional(),
  next: parameterResponseSchema.optional(),
  defaultValue: z.json().optional(),
  currentValue: z.json().optional(),
  schema: z.json().optional(),
});

export type ParameterCurrentResponse = Static<
  typeof parameterCurrentResponseSchema
>;
