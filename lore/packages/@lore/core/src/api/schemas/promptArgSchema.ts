import { type Infer, z } from "alepha";

import { PROMPT_ARG_TYPES } from "./promptValues.ts";

/**
 * One item a prompt needs (#Q4274): its name, which its placeholders read
 * (`{{epic.title}}` for an arg named `epic`), its type, and the statuses of
 * the item it accepts. The list is "this prompt makes sense for an item in
 * these statuses", not a condition language; absent, every status is
 * accepted, a shelved or deleted item never.
 */
export const promptArgSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/),
  type: z.enum(PROMPT_ARG_TYPES),
  accepts: z
    .array(z.text({ maxLength: 32 }))
    .max(8)
    .optional(),
});

export type PromptArg = Infer<typeof promptArgSchema>;
