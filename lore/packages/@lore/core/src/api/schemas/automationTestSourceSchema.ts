import { type Infer, z } from "alepha";

/**
 * A subject is a same-project resource ID for the rule's declared event.
 * Historical inputs are retained authorized evidence, never caller JSON.
 */
export const automationTestSourceSchema = z.union([
  z
    .object({
      kind: z.literal("subject"),
      id: z.union([z.integer().positive(), z.string().min(1).max(255)]),
    })
    .strict(),
  z.object({ kind: z.literal("event"), id: z.uuid() }).strict(),
  z.object({ kind: z.literal("run"), id: z.uuid() }).strict(),
]);
export type AutomationTestSource = Infer<typeof automationTestSourceSchema>;
