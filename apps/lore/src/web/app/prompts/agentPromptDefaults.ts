import type { AgentPromptKind } from "@/api/schemas/agentPromptKindSchema.ts";

import { epicActivatePromptDefault } from "./epicActivatePrompt.ts";
import { epicReviewPromptDefault } from "./epicReviewPrompt.ts";
import { feedbackWorkPromptDefault } from "./feedbackWorkPrompt.ts";
import { questWorkPromptDefault } from "./questWorkPrompt.ts";

/**
 * The built-in default for each kind: what a project gets before anyone
 * edits it in Settings > Work, and what Reset restores.
 *
 * A `Record` keyed by the schema's type rather than a lookup function, so
 * adding a literal to `agentPromptKindSchema` without writing its default is
 * a type error rather than an `undefined` on somebody's clipboard.
 *
 * `project_prompts` holds one row per CUSTOMISED kind, so absence there
 * means "the entry below". A project with the switch on and no rows pays no
 * request and gets these.
 */
export const AGENT_PROMPT_DEFAULTS: Record<AgentPromptKind, string> = {
  epicReview: epicReviewPromptDefault,
  epicActivate: epicActivatePromptDefault,
  questWork: questWorkPromptDefault,
  feedbackWork: feedbackWorkPromptDefault,
};
