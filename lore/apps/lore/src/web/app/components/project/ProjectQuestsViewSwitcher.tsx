import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useI18n } from "alepha/react/i18n";
import { Columns3, List } from "lucide-react";
import type { I18n } from "../../services/I18n.ts";
import type { QuestsView } from "./questsView.ts";

export interface ProjectQuestsViewSwitcherProps {
  view: QuestsView;
  /**
   * `false` when the project has the kanban feature off — the rail then
   * renders nothing at all rather than a single dead entry.
   */
  kanbanEnabled: boolean;
  onSelect: (view: QuestsView) => void;
}

/**
 * The slim icon rail down the left edge of the Quests content area, and the
 * only way to reach the kanban board: the 2026-08 rename turned kanban from
 * its own route into a `?view=kanban` query toggle and took the sidebar entry
 * with it, leaving the board reachable only by hand-typing the URL.
 *
 * It lives inside the content area rather than in `ProjectView`, because that
 * layout changes shape under the board (`fullWidth`, no quest log) and the
 * rail has to sit still across both branches.
 */
const ProjectQuestsViewSwitcher = (props: ProjectQuestsViewSwitcherProps) => {
  const { tr } = useI18n<I18n, "en">();

  if (!props.kanbanEnabled) {
    return null;
  }

  const entries: Array<{
    view: QuestsView;
    icon: typeof List;
    label: string;
  }> = [
    { view: "list", icon: List, label: tr("board.view.list") },
    { view: "kanban", icon: Columns3, label: tr("board.view.kanban") },
  ];

  return (
    <div
      data-testid="quests-view-switcher"
      className="border-border flex shrink-0 flex-col items-center gap-1 border-r px-1 py-2"
    >
      {entries.map((entry) => (
        <Tooltip key={entry.view}>
          <TooltipTrigger
            render={
              <Button
                variant={props.view === entry.view ? "secondary" : "ghost"}
                size="icon"
                aria-label={entry.label}
                aria-pressed={props.view === entry.view}
                data-testid={`quests-view-${entry.view}`}
                onClick={() => props.onSelect(entry.view)}
              />
            }
          >
            <entry.icon className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">{entry.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
};

export default ProjectQuestsViewSwitcher;
