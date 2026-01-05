import { type Static, t } from "alepha";

/**
 * Parameter status enum schema.
 */
export const parameterStatusSchema = t.enum([
  "expired",
  "current",
  "next",
  "future",
]);

export type ParameterStatus = Static<typeof parameterStatusSchema>;
