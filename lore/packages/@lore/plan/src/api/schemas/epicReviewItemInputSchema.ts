import { type Infer, z } from "alepha";

import { epicReviewItemKindSchema } from "./epicReviewItemKindSchema.ts";
import { epicReviewSuggestionSchema } from "./epicReviewSuggestionSchema.ts";
import { epicReviewTargetSchema } from "./epicReviewTargetSchema.ts";

/**
 * One item as a reviewer files it (#E121). The number, the state and the
 * answer are the service's to set.
 */
export const epicReviewItemInputSchema = z.object({
  kind: epicReviewItemKindSchema.describe(
    "`question` (the owner's to answer), `decision` (a call you took alone, with its reason in `context`) or `change` (what the review edited: the epic description, a quest created or sharpened).",
  ),
  title: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      "The question in one sentence, the decision taken, or the change made.",
    ),
  context: z
    .string()
    .meta({ size: "rich" })
    .describe(
      "Why: what the spec says against what the code does, the files named. Markdown.",
    )
    .optional(),
  suggestions: z
    .array(epicReviewSuggestionSchema)
    .max(10)
    .describe(
      "On a question: two or three ways forward, each with its cost. Numbered from 0.",
    )
    .optional(),
  recommended: z
    .integer()
    .min(0)
    .describe("Index into `suggestions` of the one you would take.")
    .optional(),
  target: epicReviewTargetSchema
    .describe(
      "On a change: the quest (by shortId) or epic (by number) it touched.",
    )
    .optional(),
});

export type EpicReviewItemInputBody = Infer<typeof epicReviewItemInputSchema>;
