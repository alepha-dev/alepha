import { type Static, z } from "alepha";
import { parameterResponseSchema } from "./parameterResponseSchema.ts";

/**
 * Parameter version response schema.
 */
export const parameterVersionResponseSchema = z.object({
  parameter: parameterResponseSchema.optional(),
});

export type ParameterVersionResponse = Static<
  typeof parameterVersionResponseSchema
>;
