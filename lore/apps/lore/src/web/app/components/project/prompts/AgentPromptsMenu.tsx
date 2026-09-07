import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useI18n } from "alepha/react/i18n";
import { Bot, ChevronDown } from "lucide-react";

import type { AgentPromptKind } from "@/api/schemas/agentPromptKindSchema.ts";
import type { AgentPromptSubject } from "@/web/app/prompts/renderPromptTemplate.ts";

import type { I18n } from "../../../services/I18n.ts";
import { AGENT_PROMPT_MENU_META } from "./agentPromptMenuMeta.ts";
import { useAgentPrompt } from "./useAgentPrompt.ts";

export interface AgentPromptsMenuItem {
  /**
   * Which prompt. The glyph, the label and the description all come from
   * {@link AGENT_PROMPT_MENU_META} keyed on this, so a caller cannot give
   * one and forget the others - and a fifth kind is a type error there
   * rather than a blank line here (feedback #P2149).
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

  /**
   * Render the trigger as the robot glyph alone.
   *
   * For a footer whose row is ordered by importance, where this is the
   * least urgent control and also the widest (feedback #P2150). The label
   * moves into `aria-label` AND `title` - an `aria-label` alone leaves a
   * pointer user with an unlabelled glyph, which is the rule #Q2017
   * records.
   *
   * ⚠️ **No caret in this form**, unlike the labelled one. The caret
   * (#Q2070) exists to say a word is a menu; on a 32px square it is a
   * second glyph competing with the one that names the thing, and the
   * button reads as a menu from its own shape.
   */
  iconOnly?: boolean;
}

/**
 * The Agent Prompts menu, for a DETAIL page.
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
          props.iconOnly ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={String(tr("agentPrompts.menu"))}
              title={String(tr("agentPrompts.menu"))}
            />
          ) : (
            <Button variant="outline" size="lg" />
          )
        }
      >
        <Bot className="size-4" />
        {!props.iconOnly && tr("agentPrompts.menu")}
        {/* ⚠️ Same size and opacity as `AlephaTableBulkMenu`'s, so the two
            read as one kind of control; `Down` rather than `Up` because
            this menu opens downward. It is decoration and carries no
            accessible name of its own - the trigger is already named by
            its label, and in the icon form there is no label to qualify. */}
        {!props.iconOnly && <ChevronDown className="size-3.5 opacity-70" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {props.items.map((item) => {
          const meta = AGENT_PROMPT_MENU_META[item.kind];
          return (
            <DropdownMenuItem
              key={item.kind}
              onClick={() => agentPrompt.copy(item.kind, item.subject())}
              // The default row centres one line of text against the icon;
              // with two lines the icon belongs at the top of them.
              className="items-start gap-2"
            >
              <meta.Icon className="mt-0.5 size-4 shrink-0" />
              <span className="flex flex-col gap-0.5">
                <span>{tr(meta.labelKey as never)}</span>
                {/* One line saying what the prompt does, so picking between
                    four templates does not mean copying one to find out. */}
                <span className="text-muted-foreground text-xs">
                  {tr(meta.descriptionKey as never)}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
