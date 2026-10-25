import { type Infer, z } from "alepha";

/**
 * Parameter status enum schema.
 */
export const parameterStatusSchema = z.enum([
  "expired",
  "current",
  "next",
  "future",
]);

export type ParameterStatus = Infer<typeof parameterStatusSchema>;
