import { type Infer, z } from "alepha";

/**
 * A preset as its card shows it (#Q3812, reshaped by #Q3851): the one line
 * of a folded block. What starts it (an event's type, or `schedule` and
 * what it reads), whether it checks a condition, its first action's type
 * and how many actions follow. Types only: no recipient, filter value or
 * text leaves the server this way.
 */
export const automationPresetSketchSchema = z
  .object({
    source: z.string().max(128),
    read: z.string().max(128).optional(),
    condition: z.boolean(),
    action: z.string().max(128).optional(),
    more: z.integer().min(0).max(40),
  })
  .strict();
export type AutomationPresetSketch = Infer<typeof automationPresetSketchSchema>;
