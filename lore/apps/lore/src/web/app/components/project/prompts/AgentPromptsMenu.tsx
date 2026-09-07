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
import { useAgentPrompt } from "./useAgentPrompt.ts";

export interface AgentPromptsMenuItem {
  kind: AgentPromptKind;
  label: string;
  subject: AgentPromptSubject;
}

export interface AgentPromptsMenuProps {
  items: AgentPromptsMenuItem[];
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
      <DropdownMenuTrigger render={<Button variant="outline" size="lg" />}>
        <Bot className="size-4" />
        {tr("agentPrompts.menu")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {props.items.map((item) => (
          <DropdownMenuItem
            key={item.kind}
            onClick={() => agentPrompt.copy(item.kind, item.subject)}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
