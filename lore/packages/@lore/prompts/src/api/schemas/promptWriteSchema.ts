import {
  PROMPT_CHECKS,
  PROMPT_MAX_ARGS,
  agentRunSchema,
  agentRunSourceSchema,
  promptArgSchema,
} from "@lore/core/schemas";
import { type Infer, z } from "alepha";

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
  /**
   * The trigger, in one word (#Q4277): `manual`, `event:<key>[,<key>]`,
   * `hourly`, `6h`, `daily@<h>`, `weekly@<day>@<h>`, or an event part and a
   * schedule part joined by a comma. Writable on a built-in.
   */
  on: z.string().max(1024).optional(),
  check: z.array(z.enum(PROMPT_CHECKS)).max(4).nullable().optional(),
  /**
   * A stored value per arg the trigger does not fill.
   */
  argValues: z
    .record(z.string().max(32), z.string().max(120))
    .nullable()
    .optional(),
  maxRunsPerHour: z.integer().min(1).max(60).optional(),
  maxRunsPerDay: z.integer().min(1).max(1000).optional(),
  settleSeconds: z.integer().min(0).max(3600).optional(),
  /**
   * The pages it is pinned to (#Q4284), by key; writable on a built-in.
   */
  pins: z.array(z.string().max(32)).max(16).optional(),
});

export type PromptWrite = Infer<typeof promptWriteSchema>;
