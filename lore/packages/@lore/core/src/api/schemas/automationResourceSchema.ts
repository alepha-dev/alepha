import { type Infer, z } from "alepha";

import { automationGraphSchema } from "./automationGraphSchema.ts";
import { automationResourceSourceSchema } from "./automationResourceSourceSchema.ts";
import { automationRunStatusSchema } from "./automationRunStatusSchema.ts";

/**
 * Explicit public shape. Credential identities and scope ceilings stay private.
 */
export const automationResourceSchema = z
  .object({
    id: z.uuid(),
    projectId: z.integer(),
    authorUserId: z.uuid(),
    authorName: z.string().optional(),
    title: z.string().max(255),
    enabled: z.boolean(),
    health: z.enum(["active", "paused", "broken"]),
    displayState: z.enum(["disabled", "active", "paused", "broken"]),
    requiresApproval: z.boolean(),
    reason: z.string().max(1024).optional(),
    revision: z.integer().nonnegative(),
    rule: automationGraphSchema.nullable(),
    /**
     * Each source's switch and health (#Q3806); absent when redacted.
     * `partial`: active, with at least one enabled source that cannot run.
     */
    sources: z.array(automationResourceSourceSchema).max(8).optional(),
    partial: z.boolean().optional(),
    redacted: z.boolean(),
    redactionReason: z.string().max(255).optional(),
    presetKey: z.string().max(128).optional(),
    /** Present, and true, on a rule a subscription toggle created. */
    subscription: z.boolean().optional(),
    nextRunAt: z.datetime().optional(),
    createdAt: z.datetime(),
    updatedAt: z.datetime(),
    lastRun: z
      .object({
        id: z.uuid(),
        status: automationRunStatusSchema,
        at: z.datetime(),
        capped: z.boolean().optional(),
        noData: z.boolean().optional(),
      })
      .strict()
      .optional(),
    canEdit: z.boolean(),
    canEnable: z.boolean(),
    canDisable: z.boolean(),
    canDelete: z.boolean(),
  })
  .strict();
export type AutomationResource = Infer<typeof automationResourceSchema>;
