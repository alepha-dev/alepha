import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { AgentPromptKind } from "@/api/schemas/agentPromptKindSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { projectPromptsAtom } from "@/web/app/atoms/projectPromptsAtom.ts";
import { AGENT_PROMPT_DEFAULTS } from "@/web/app/prompts/agentPromptDefaults.ts";
import {
  type AgentPromptSubject,
  renderPromptTemplate,
} from "@/web/app/prompts/renderPromptTemplate.ts";
import { capabilityOption } from "@/web/app/services/projectCapabilities.ts";

import type { I18n } from "../../../services/I18n.ts";

export interface AgentPromptHandle {
  /**
   * Whether this project offers the Agent Prompts menus at all: the Work
   * option `agentPrompts`, off by default.
   */
  enabled: boolean;
  /**
   * Render one prompt and put it on the clipboard, toasting either way.
   */
  copy: (kind: AgentPromptKind, subject: AgentPromptSubject) => Promise<void>;
}

/**
 * The one hook every Agent Prompts menu calls, on all four surfaces.
 *
 * A hook rather than a copy per surface because there are five call sites
 * across four components, and the thing they must agree on is not the label
 * but the two rules below.
 *
 * ⚠️ **The write happens inside the caller's click, with nothing awaited
 * before it.** Safari's transient activation does not survive an `await`, so
 * fetching the template at click time would make the copy fail there and
 * nowhere else. The templates are already in `projectPromptsAtom`, put there
 * by the `project` route loader, and rendering is synchronous. That is the
 * whole reason the atom exists, and it is why this hook must never grow a
 * fetch.
 *
 * ⚠️ **The caller passes seven named fields, never a resource.** This text
 * leaves Lore through the clipboard and lands wherever the reader pastes it;
 * a sigil key, a token or a reporter's email must have no path into it. The
 * type is what enforces it, so do not widen `AgentPromptSubject` to accept a
 * resource "for convenience".
 *
 * A kind with no stored template falls back to its built-in default, which is
 * what makes "absence means the default" true on the read side too.
 */
export const useAgentPrompt = (): AgentPromptHandle => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const [project] = useStore(currentProjectAtom);
  const [prompts] = useStore(projectPromptsAtom);

  return {
    enabled: capabilityOption(project, "work", "agentPrompts"),
    copy: async (kind, subject) => {
      const template = prompts?.[kind] ?? AGENT_PROMPT_DEFAULTS[kind];
      const text = renderPromptTemplate(template, subject);
      try {
        await navigator.clipboard.writeText(text);
        toaster.success(
          tr("agentPrompts.copied", { args: [subject.reference] }),
        );
      } catch {
        toaster.error(tr("agentPrompts.copyError"));
      }
    },
  };
};
