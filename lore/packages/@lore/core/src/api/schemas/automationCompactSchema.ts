import { type Infer, z } from "alepha";

import { automationGraphNodeIdSchema } from "./automationGraphNodeIdSchema.ts";

/**
 * The compact way to write an automation (#Q3809): its sources and its
 * actions, every source wired to every action, laid out by the server.
 * "When X or Y, notify me" in one call. An action that names a field one
 * source lacks is refused: give that source its own action with the full
 * `nodes` + `edges` form.
 */
export const automationCompactSchema = z
  .object({
    sources: z
      .array(
        z
          .object({
            type: z.string().min(1).max(128),
            config: z.record(z.string().max(64), z.any()).optional(),
            id: automationGraphNodeIdSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    actions: z
      .array(
        z
          .object({
            type: z.string().min(1).max(128),
            config: z.record(z.string().max(64), z.any()),
            id: automationGraphNodeIdSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
export type AutomationCompactInput = Infer<typeof automationCompactSchema>;
