import { type Infer, z } from "alepha";

import { promptArgSchema } from "./promptArgSchema.ts";
import { PROMPT_SOURCES } from "./promptValues.ts";

/**
 * A prompt as the API answers it (#Q4274): a built-in merged with the
 * project's row configuring it, or a custom prompt. `text` and `args` of a
 * built-in are the registry's, frozen.
 */
export const promptResourceSchema = z.object({
  name: z.text({ maxLength: 64 }),
  builtin: z.boolean(),
  title: z.text({ maxLength: 120 }),
  description: z.string().max(2000),
  args: z.array(promptArgSchema),
  text: z.string().max(131_072),
  source: z.enum(PROMPT_SOURCES),
  ref: z.text({ maxLength: 200 }).optional(),
  host: z.text({ maxLength: 64 }).optional(),
  agent: z.text({ maxLength: 32 }).optional(),
  model: z.text({ maxLength: 96 }).optional(),
  enabled: z.boolean(),
  /**
   * What a run needs beyond `host:read`, and how long it may take.
   */
  permission: z.text({ maxLength: 64 }),
  timeoutSeconds: z.integer(),
  createdBy: z.uuid().optional(),
  updatedAt: z.datetime().optional(),
});

export type PromptResource = Infer<typeof promptResourceSchema>;
