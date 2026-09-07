import {
  ClipboardCheck,
  type LucideIcon,
  PlayCircle,
  Wrench,
} from "lucide-react";

import type { AgentPromptKind } from "@/api/schemas/agentPromptKindSchema.ts";

/**
 * What one prompt looks like in a menu: its glyph, its label and the line
 * under it.
 *
 * ## One record, not three lookups
 *
 * A `Record` keyed by the schema's own type, like `AGENT_PROMPT_DEFAULTS`
 * beside it, so adding a literal to `agentPromptKindSchema` without giving
 * it a label AND a description AND an icon is a type error rather than a
 * blank second line on somebody's menu (feedback #P2149 asked for the
 * descriptions; this is what keeps the fifth one from arriving without
 * either).
 *
 * The keys are i18n keys rather than strings: this module is imported by
 * components that already hold a `tr`, and a translated string here would
 * need a hook a plain module cannot call.
 *
 * ⚠️ **Built-in kinds only, and the set is closed by design.** The prompt
 * TEXT is user-editable in Settings, but the four kinds are not: a project
 * cannot invent a fifth. So there is no "custom prompt" row to give a
 * default glyph to - what an owner customises is the template behind one of
 * these four, and the row keeps the icon and the description of the kind it
 * is. The description says what the prompt is FOR, which stays true when
 * its wording changes; a description generated from the template would go
 * stale the first time somebody edited it.
 */
export interface AgentPromptMenuMeta {
  Icon: LucideIcon;
  labelKey: string;
  descriptionKey: string;
}

export const AGENT_PROMPT_MENU_META: Record<
  AgentPromptKind,
  AgentPromptMenuMeta
> = {
  epicReview: {
    Icon: ClipboardCheck,
    labelKey: "agentPrompts.review",
    descriptionKey: "agentPrompts.review.description",
  },
  epicActivate: {
    Icon: PlayCircle,
    labelKey: "agentPrompts.activate",
    descriptionKey: "agentPrompts.activate.description",
  },
  questWork: {
    Icon: Wrench,
    labelKey: "agentPrompts.workOnIt",
    descriptionKey: "agentPrompts.questWork.description",
  },
  feedbackWork: {
    Icon: Wrench,
    labelKey: "agentPrompts.workOnIt",
    descriptionKey: "agentPrompts.feedbackWork.description",
  },
};
