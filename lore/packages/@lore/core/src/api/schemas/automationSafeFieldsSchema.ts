import { z } from "alepha";

/**
 * Context builders supply allowlisted scalar fields, never raw resource objects.
 */
export const automationSafeFieldsSchema = z
  .record(
    z.string().min(1).max(128),
    z.union([
      z.string().max(16_384),
      z.number().finite(),
      z.boolean(),
      z.null(),
    ]),
  )
  .refine((value) => Object.keys(value).length <= 64);
