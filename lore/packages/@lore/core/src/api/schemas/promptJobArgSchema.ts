import { type Infer, z } from "alepha";

import { PROMPT_ARG_TYPES } from "./promptValues.ts";

/**
 * One arg of a run, as it ran (#Q4275): its name and type, the value given,
 * and the item's reference and title when it named one, so the job's page
 * reads it even after the item changed.
 */
export const promptJobArgSchema = z.object({
  name: z.string().max(32),
  type: z.enum(PROMPT_ARG_TYPES),
  value: z.string().max(120),
  reference: z.string().max(120).optional(),
  title: z.string().max(300).optional(),
});

export type PromptJobArg = Infer<typeof promptJobArgSchema>;
