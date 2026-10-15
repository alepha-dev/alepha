import { z } from "alepha";

/**
 * Literal slot values. Whole-placeholder strings are resolved before type checks.
 */
export const automationValueSchema = z.union([
  z.string().max(16_384),
  z.number().finite(),
  z.boolean(),
]);
