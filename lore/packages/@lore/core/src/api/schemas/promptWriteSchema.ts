import { type Infer, z } from "alepha";

import { agentRunSchema, agentRunSourceSchema } from "./agentRunSchema.ts";
import { promptArgSchema } from "./promptArgSchema.ts";
import { PROMPT_MAX_ARGS } from "./promptValues.ts";

/**
 * The fields of a prompt a write sets (#Q4274). On a built-in only `source`,
 * `ref`, `host`, `agent`, `model` and `enabled` are writable; its title,
 * description, text and args are refused. `null` clears an optional field.
 */
export const promptWriteSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  text: z.string().min(1).max(131_072).optional(),
  args: z.array(promptArgSchema).max(PROMPT_MAX_ARGS).optional(),
  source: agentRunSourceSchema.shape.source.unwrap().optional(),
  ref: agentRunSourceSchema.shape.ref.unwrap().nullable().optional(),
  host: agentRunSchema.shape.host.unwrap().nullable().optional(),
  agent: agentRunSchema.shape.agent.unwrap().nullable().optional(),
  model: agentRunSchema.shape.model.unwrap().nullable().optional(),
  enabled: z.boolean().optional(),
});

export type PromptWrite = Infer<typeof promptWriteSchema>;
