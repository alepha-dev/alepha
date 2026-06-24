import { type Static, z } from "alepha";

/**
 * Parameter names list response schema.
 */
export const parameterNamesResponseSchema = z.object({
  names: z.array(z.text()),
});

export type ParameterNamesResponse = Static<
  typeof parameterNamesResponseSchema
>;
