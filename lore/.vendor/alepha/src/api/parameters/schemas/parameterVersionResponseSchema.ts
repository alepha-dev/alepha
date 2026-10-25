import { type Infer, z } from "alepha";

import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Parameter version response schema.
 */
export const parameterVersionResponseSchema = z.object({
  parameter: parameterResponseSchema.optional(),
});

export type ParameterVersionResponse = Infer<
  typeof parameterVersionResponseSchema
>;
