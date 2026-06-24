import { type Static, z } from "alepha";

/**
 * Parameter status enum schema.
 */
export const parameterStatusSchema = z.enum([
  "expired",
  "current",
  "next",
  "future",
]);

export type ParameterStatus = Static<typeof parameterStatusSchema>;
