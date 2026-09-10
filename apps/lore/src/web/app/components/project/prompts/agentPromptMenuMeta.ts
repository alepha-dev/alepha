import {
  Bug,
  ClipboardCheck,
  ListChecks,
  type LucideIcon,
  Wrench,
} from "lucide-react";

import type { AgentPromptKind } from "@/api/schemas/agentPromptKindSchema.ts";

/**
 * What one prompt looks like in a menu: its glyph and its label.
 *
 * ## One record, not two lookups
 *
 * A `Record` keyed by the schema's own type, like `AGENT_PROMPT_DEFAULTS`
 * beside it, so adding a literal to `agentPromptKindSchema` without giving
 * it a label AND an icon is a type error rather than a bare row on
 * somebody's menu.
 *
 * ## ⚠️ No description, and that is a reversal
 *
 * Feedback #P2149 gave every entry a line under its label saying what the
 * prompt is for, so picking between templates would not mean copying one to
 * find out. Feedback #P2183 took it off again, on every surface, by the
 * owner's ruling: the label carries the choice alone. So a label that does
 * not say which prompt it is gets fixed in the label (#P2182 on epics), and
 * the line does not come back. `agentPrompts.settings.*.description` is not
 * a menu and keeps its text.
 *
 * The keys are i18n keys rather than strings: this module is imported by
 * components that already hold a `tr`, and a translated string here would
 * need a hook a plain module cannot call.
 *
 * ⚠️ **Built-in kinds only, and the set is closed by design.** The prompt
 * TEXT is user-editable in Settings, but the kinds are not: a project cannot
 * invent another. So there is no "custom prompt" row to give a default glyph
 * to - what an owner customises is the template behind one of these, and the
 * row keeps the icon and the label of the kind it is.
 */
export interface AgentPromptMenuMeta {
  Icon: LucideIcon;
  labelKey: string;
}

export const AGENT_PROMPT_MENU_META: Record<
  AgentPromptKind,
  AgentPromptMenuMeta
> = {
  epicReview: {
    Icon: ClipboardCheck,
    labelKey: "agentPrompts.review",
  },
  // `Wrench` and "Work on it", like the two below: handing an epic over is
  // the same verb as handing over a quest or a report, so it reads the same
  // on all three surfaces (feedback #P2182). Only the label and the glyph:
  // the kind stays `epicActivate`, because it is persisted in
  // `project_prompts.kind` and a rename would orphan every stored template.
  epicActivate: {
    Icon: Wrench,
    labelKey: "agentPrompts.workOnIt",
  },
  questWork: {
    Icon: Wrench,
    labelKey: "agentPrompts.workOnIt",
  },
  feedbackWork: {
    Icon: Wrench,
    labelKey: "agentPrompts.workOnIt",
  },
  // ⚠️ Its own glyph and its own label, not `Wrench` and "Work on it". The
  // three above share those because they are the same verb on three
  // surfaces; this is a different verb on a surface none of them touches,
  // and a menu where every row is a wrench says nothing.
  feedbackLoop: {
    Icon: ListChecks,
    labelKey: "agentPrompts.triageInbox",
  },
  // `Bug`, not `ListChecks`: both are triage loops, and the surface is what
  // tells them apart in a menu.
  blightTriage: {
    Icon: Bug,
    labelKey: "agentPrompts.triageBlights",
  },
};
