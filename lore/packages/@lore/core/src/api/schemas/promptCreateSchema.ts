import { type Infer, z } from "alepha";

import { PROMPT_NAME_PATTERN } from "./promptValues.ts";
import { promptWriteSchema } from "./promptWriteSchema.ts";

/**
 * A new custom prompt: a name and words, the rest optional.
 */
export const promptCreateSchema = promptWriteSchema.extend({
  name: z.string().regex(PROMPT_NAME_PATTERN),
  text: z.string().min(1).max(131_072),
});

export type PromptCreate = Infer<typeof promptCreateSchema>;
