import { type Infer, z } from "alepha";

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
  /**
   * The `$parameter({ description })` of the registered primitive — what this
   * setting IS, in the words of whoever declared it. Without it the admin UI
   * can only show a prettified key ("ReducedFactor"), which tells an operator
   * nothing.
   */
  description: z.text().optional(),
});

export type ParameterCurrentResponse = Infer<
  typeof parameterCurrentResponseSchema
>;
