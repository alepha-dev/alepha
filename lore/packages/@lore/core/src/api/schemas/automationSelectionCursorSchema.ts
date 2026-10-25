import { type Infer, z } from "alepha";

/**
 * Internal keyset cursor, not another user-configurable query language.
 */
export const automationSelectionCursorSchema = z
  .object({
    seen: z.integer().nonnegative().optional(),
    shortId: z.integer().positive(),
    at: z.datetime().optional(),
  })
  .strict();
export type AutomationSelectionCursor = Infer<
  typeof automationSelectionCursorSchema
>;
