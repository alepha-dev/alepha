import { type Infer, z } from "alepha";

/**
 * What a host job runs, as stored on its row (#Q3984, light since #Q4222):
 * Lore's half of Bay's `jobSpec`, without the credential. The job key is
 * minted when the machine pulls the spec, so no row ever holds it; `key`
 * here is only its pins.
 *
 * Bounded like Bay bounds it, so a spec Lore would build is never one Bay
 * refuses for its size. Bay validates every field again and builds the
 * command line from its adapter for the agent.
 */
export const hostJobInputSchema = z.object({
  agent: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/)
    .optional(),
  model: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{0,79}(?:\[1m\])?$/)
    .optional(),
  workspace: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
    .optional(),
  prompt: z.string().max(131_072).optional(),
  timeoutSeconds: z.integer().min(10).max(14_400),
  key: z
    .object({
      questId: z.integer().optional(),
      feedbackId: z.integer().optional(),
      feedbackIds: z.array(z.integer()).max(50).optional(),
      epicId: z.integer().optional(),
    })
    .optional(),
});

export type HostJobInputRow = Infer<typeof hostJobInputSchema>;
