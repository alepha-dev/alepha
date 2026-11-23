import { type Infer, z } from "alepha";

/**
 * What a member picks when starting an agent job (#Q4223): the Agent host by
 * slug, the agent CLI by Bay's adapter name, and the model passed to it.
 * Each may be left out: the project's only host, the host's only agent, the
 * CLI's own default model.
 */
export const agentRunSchema = z.object({
  host: z.text({ maxLength: 64 }).optional(),
  agent: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/)
    .optional(),
  model: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{0,79}(?:\[1m\])?$/)
    .optional(),
});

export type AgentRun = Infer<typeof agentRunSchema>;

/**
 * One host and agent a run may pick, as the agent entries offer them.
 */
export const agentRunChoiceSchema = z.object({
  host: z.text({ maxLength: 64 }),
  agent: z.text({ maxLength: 32 }).optional(),
});

export type AgentRunChoice = Infer<typeof agentRunChoiceSchema>;
