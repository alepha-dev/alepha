import { type Infer, z } from "alepha";

/**
 * A chat agent as the API answers it (#E170): the built-in `lore` (id and
 * handle `lore`, `builtin`) or one of the project's own.
 */
export const chatAgentResourceSchema = z.object({
  /**
   * The row's uuid, or the built-in's handle.
   */
  id: z.text(),
  handle: z.text(),
  name: z.text(),
  builtin: z.boolean(),
  avatarId: z.uuid().optional(),
  avatarUrl: z.text().optional(),
  /**
   * Its model id; none means the instance default.
   */
  model: z.text().optional(),
  /**
   * Its AI provider (#Q4250): `api`, or `host` with the Agent host, agent
   * CLI and model it runs on. The built-in `lore`'s is the project's.
   */
  engine: z.enum(["api", "host"]).optional(),
  engineHost: z.text().optional(),
  engineAgent: z.text().optional(),
  engineModel: z.text().optional(),
  createdBy: z.uuid().optional(),
  createdAt: z.datetime().optional(),
  deletedAt: z.datetime().optional(),
  /**
   * The persona and playbook, on a single agent's read.
   */
  prePrompt: z.text({ size: "rich" }).optional(),
});

export type ChatAgentResource = Infer<typeof chatAgentResourceSchema>;

/**
 * What creates an agent, and (every field optional) edits one.
 */
export const chatAgentBodySchema = z.object({
  handle: z.text({ maxLength: 32 }),
  name: z.text({ minLength: 1, maxLength: 60 }),
  /**
   * An image uploaded to the `chat-agent-avatars` bucket; `null` removes it.
   */
  avatar: z.uuid().nullable().optional(),
  /**
   * A model id; empty or `null` is the instance default. Checked only when
   * the agent runs.
   */
  model: z.text({ maxLength: 120 }).nullable().optional(),
  /**
   * Its AI provider (#Q4250): `api` (the instance's model) or `host` (an
   * agent CLI on an Agent host, reading the code). `null` on a host field
   * goes back to the project's only one, or the CLI's default model.
   */
  engine: z.enum(["api", "host"]).optional(),
  engineHost: z.text({ maxLength: 64 }).nullable().optional(),
  engineAgent: z.text({ maxLength: 32 }).nullable().optional(),
  engineModel: z.text({ maxLength: 80 }).nullable().optional(),
  /**
   * Markdown: the persona and its playbook.
   */
  prePrompt: z.text({ size: "rich" }).optional(),
});

export type ChatAgentBody = Infer<typeof chatAgentBodySchema>;
