import { type Infer, z } from "alepha";

/**
 * What a host job runs, as stored on its row (#Q3984): Lore's half of Bay's
 * `jobSpec`, without the credential. The job key is minted when the machine
 * pulls the spec, so no row ever holds it; `key` here is only its scope.
 *
 * Bounded like Bay bounds it, so a spec Lore would build is never one Bay
 * refuses for its size. Bay validates every field again and builds the
 * command line itself.
 */
export const hostJobInputSchema = z.object({
  profile: z.enum(["check", "read", "push"]),
  workspace: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
    .optional(),
  prompt: z.string().max(131_072).optional(),
  maxTurns: z.integer().min(1).max(500),
  timeoutSeconds: z.integer().min(10).max(14_400),
  allowedTools: z.array(z.string().max(220)).max(64).optional(),
  disallowedTools: z.array(z.string().max(220)).max(64).optional(),
  permissionMode: z.string().max(20).optional(),
  egress: z.array(z.string().max(253)).max(50).optional(),
  image: z.string().max(300).optional(),
  key: z
    .object({
      tools: z.array(z.string().max(100)).max(64),
      repositoryId: z.string().max(64).optional(),
      writeRefPrefix: z.string().max(200).optional(),
      questId: z.integer().optional(),
      feedbackId: z.integer().optional(),
      feedbackIds: z.array(z.integer()).max(50).optional(),
      epicId: z.integer().optional(),
    })
    .optional(),
});

export type HostJobInputRow = Infer<typeof hostJobInputSchema>;
