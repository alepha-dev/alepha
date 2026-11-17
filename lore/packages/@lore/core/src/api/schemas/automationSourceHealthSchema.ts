import { type Infer, z } from "alepha";

/**
 * Each source's own health (#Q3806), by source node id: a dependency it or
 * every path from it needs is gone (`broken`), or it can run. Stored beside
 * `health`, outside the rule, so a health write never bumps the revision.
 */
export const automationSourceHealthSchema = z.record(
  z.string().max(64),
  z
    .object({
      health: z.enum(["active", "broken"]),
      reason: z.string().max(1024).optional(),
    })
    .strict(),
);
export type AutomationSourceHealth = Infer<typeof automationSourceHealthSchema>;
