import { type Infer, z } from "alepha";

import { automationRuleSchema } from "./automationRuleSchema.ts";
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
    rule: automationRuleSchema.nullable(),
    redacted: z.boolean(),
    redactionReason: z.string().max(255).optional(),
    presetKey: z.string().max(128).optional(),
    nextRunAt: z.datetime().optional(),
    createdAt: z.datetime(),
    updatedAt: z.datetime(),
    lastRun: z
      .object({
        id: z.uuid(),
        status: automationRunStatusSchema,
        at: z.datetime(),
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
