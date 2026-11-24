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
   * Markdown: the persona and its playbook.
   */
  prePrompt: z.text({ size: "rich" }).optional(),
});

export type ChatAgentBody = Infer<typeof chatAgentBodySchema>;
