import { type Infer, z } from "alepha";

/**
 * One agent CLI of an Agent host a run may pick (#Q4504): its adapter name,
 * and whether it says it is signed in, absent when it has no status
 * command or the host's Bay sent none.
 */
export const promptHostAgentSchema = z.object({
  host: z.text({ maxLength: 64 }),
  agent: z.text({ maxLength: 32 }),
  signedIn: z.boolean().optional(),
});

export type PromptHostAgent = Infer<typeof promptHostAgentSchema>;
