import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useI18n } from "alepha/react/i18n";
import { Columns3, List } from "lucide-react";
import type { QuestsView } from "../../atoms/questsViewAtom.ts";
import type { I18n } from "../../services/I18n.ts";

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
 * The slim icon rail down the far-left edge of the project content area, and
 * the only way to reach the kanban board: the 2026-08 rename turned kanban
 * from its own route into a view of the Quests page and took the sidebar
 * entry with it, leaving the board unreachable from the UI at all. The view
 * itself lives in `questsViewAtom` since #156 — there is no URL to type.
 *
 * Rendered by `ProjectView`, as the first child of the content area and
 * OUTSIDE its `showQuestLog / fullWidth / else` branch (#153). It first lived
 * inside the Quests page, which put it between the quest log and the table
 * and made it read as a control for the table; the branch is the reason it
 * cannot simply be moved within the page — anything a `NestedView` renders is
 * necessarily right of the log. Staying outside the branch is what keeps the
 * rail's x-position identical whether the layout shows the quest log, goes
 * full width under the board, or centers a column.
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
