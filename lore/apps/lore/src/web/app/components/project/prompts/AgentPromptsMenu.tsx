import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useI18n } from "alepha/react/i18n";
import { Bot } from "lucide-react";

import type { AgentPromptKind } from "@/api/schemas/agentPromptKindSchema.ts";
import type { AgentPromptSubject } from "@/web/app/prompts/renderPromptTemplate.ts";

import type { I18n } from "../../../services/I18n.ts";
import { AGENT_PROMPT_MENU_META } from "./agentPromptMenuMeta.ts";
import { useAgentPrompt } from "./useAgentPrompt.ts";

export interface AgentPromptsMenuItem {
  /**
   * Which prompt. The glyph and the label both come from
   * {@link AGENT_PROMPT_MENU_META} keyed on this, so a caller cannot give
   * one and forget the other - and a fifth kind is a type error there
   * rather than a bare row here.
   */
  kind: AgentPromptKind;
  /**
   * ⚠️ A thunk, not a value, and called only when the entry is clicked.
   *
   * Building a subject reaches for the router, so an eager one costs a
   * `router.path` on every render of every surface that MIGHT show this
   * menu, including the ones where it renders nothing - which is the
   * default state, the option being off. It also made mounting those
   * components require the full route table even with the menu hidden,
   * which broke four unrelated specs before this was a thunk.
   */
  subject: () => AgentPromptSubject;
}

export interface AgentPromptsMenuProps {
  items: AgentPromptsMenuItem[];
}

/**
 * The Agent Prompts menu, for a DETAIL page: the robot glyph alone.
 *
 * ⚠️ **The labelled form is gone** (feedback #P2175), and with it the
 * `iconOnly` prop that selected between the two - every one of the six mounts
 * passed it. Deleted deliberately rather than left as a branch nobody takes.
 *
 * What went with it is worth recording, because it was argued for once. The
 * labelled trigger carried a `ChevronDown`, added by #Q2070 to say that a WORD
 * is a menu; with no word there is nothing for a caret to qualify, and on a
 * 32px square it was a second glyph competing with the one that names the
 * thing. The label moves to `aria-label` AND `title` - an `aria-label` alone
 * leaves a pointer user with an unlabelled glyph, which is the rule #Q2017
 * records, and the reason the icon form always carried both.
 *
 * ⚠️ A menu with a visible label needs that caret back if this is ever
 * reversed. Do not reintroduce the labelled trigger without it.
 *
 * The row-menu form of this is a `RowActionGroup` handed to `AlephaTable`;
 * this is the same set of entries behind a button of its own, for the pages
 * that have no row menu to hang them off. One component rather than one per
 * page: an epic, a quest and a feedback item offer different entries but the
 * same gesture, and three copies would eventually disagree about the icon,
 * the button variant or the label.
 *
 * ⚠️ **Renders nothing when the project has the option off, and nothing when
 * `items` is empty.** The second half matters: callers build their entries
 * under status gates, so an epic that is `done` hands over an empty list, and
 * a button opening an empty menu is worse than no button. Same rule
 * `AlephaTable` applies to an empty group.
 *
 * The subject is built by the caller through `useAgentPromptSubject`, field
 * by field, and never from a resource.
 */
export const AgentPromptsMenu = (props: AgentPromptsMenuProps) => {
  const { tr } = useI18n<I18n, "en">();
  const agentPrompt = useAgentPrompt();

  if (!agentPrompt.enabled || props.items.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={String(tr("agentPrompts.menu"))}
            title={String(tr("agentPrompts.menu"))}
          />
        }
      >
        <Bot className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {props.items.map((item) => {
          const meta = AGENT_PROMPT_MENU_META[item.kind];
          return (
            // The label alone, on the default one-line row (feedback
            // #P2183). The line under it that #P2149 asked for is gone on
            // every surface, so do not bring it back from an older comment.
            <DropdownMenuItem
              key={item.kind}
              onClick={() => agentPrompt.copy(item.kind, item.subject())}
            >
              <meta.Icon />
              {tr(meta.labelKey as never)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
