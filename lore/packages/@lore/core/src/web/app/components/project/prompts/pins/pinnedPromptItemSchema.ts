import { type Infer, z } from "alepha";

import { PROMPT_ARG_TYPES } from "../../../../../../api/schemas/promptValues.ts";

/**
 * The item a pinnable page or a row gives (#Q4284): its type, the value its
 * arg takes (an epic's or a quest's number), and its status, which decides
 * whether a prompt whose arg does not accept it is offered.
 */
export const pinnedPromptItemSchema = z.object({
  type: z.enum(PROMPT_ARG_TYPES),
  value: z.string(),
  status: z.string().optional(),
});

export type PinnedPromptItem = Infer<typeof pinnedPromptItemSchema>;
