import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { Plus } from "lucide-react";

import type { AutomationCatalogNodeType } from "../../../../../../api/schemas/automationCatalogNodeTypeSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { AutomationOutlineIcons } from "./AutomationOutlineIcons.ts";

export interface AutomationOutlineActionMenuProps {
  label: string;
  actions: Array<{ nodeType: AutomationCatalogNodeType; reason?: string }>;
  disabled?: boolean;
  onPick: (nodeType: AutomationCatalogNodeType) => void;
  testId?: string;
}

/**
 * The actions a sequence may hold (#Q3848), an unavailable one saying why.
 */
const AutomationOutlineActionMenu = (
  props: AutomationOutlineActionMenuProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={props.disabled}
        render={
          <Button variant="minimal" size="sm" data-testid={props.testId} />
        }
      >
        <Plus />
        {props.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {props.actions.map((entry) => {
          const Icon = AutomationOutlineIcons.of(entry.nodeType);
          return (
            <DropdownMenuItem
              key={entry.nodeType.type}
              disabled={!!entry.reason}
              onClick={() => props.onPick(entry.nodeType)}
              data-testid={`automation-outline-action-${entry.nodeType.type}`}
            >
              <Icon />
              <span className="flex flex-col">
                <span>
                  {tr(`automation.action.${entry.nodeType.type}`, {
                    default: entry.nodeType.type,
                  })}
                </span>
                {entry.reason && (
                  <span className="text-muted-foreground text-xs">
                    {entry.reason}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AutomationOutlineActionMenu;
