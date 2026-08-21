import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  BookOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  PanelLeftClose,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { currentAssignedQuestsAtom } from "../../atoms/currentAssignedQuestsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import QuestList from "./quest/QuestList.tsx";

export interface QuestLogProps {
  /**
   * Collapses the whole pane to `ProjectQuestLogRail`.
   *
   * A callback rather than this component reading `questLogCollapsedAtom`
   * directly: `ProjectView` owns the layout, and it is the only component that
   * can swap this pane for the rail. Reading the atom here would let the log
   * set a flag that something else has to notice.
   */
  onCollapse: () => void;
}

const QuestLog = (props: QuestLogProps) => {
  const [quests = []] = useStore(currentAssignedQuestsAtom);
  const { tr } = useI18n<I18n, "en">();
  const [searchValue, setSearchValue] = useState<string>("");
  // Global collapse directive — bumped on click. QuestGroup listens to
  // `collapseSignal.version` and snaps its local state to `collapsed`.
  const [collapseSignal, setCollapseSignal] = useState({
    collapsed: false,
    version: 0,
  });

  const filteredQuests = useMemo(() => {
    if (!searchValue.trim()) {
      return quests;
    }
    return quests.filter((quest) =>
      quest.title.toLowerCase().includes(searchValue.toLowerCase().trim()),
    );
  }, [quests, searchValue]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(event.currentTarget.value);
  };

  const handleClearSearch = () => {
    setSearchValue("");
  };

  const toggleAll = () => {
    setCollapseSignal((s) => ({
      collapsed: !s.collapsed,
      version: s.version + 1,
    }));
  };

  return (
    // `lore-quest-log-facets` is an EXPERIMENT: a faint argyle diamond
    // lattice tinted with the active theme's primary, defined in `main.css`.
    // It is decoration and nothing depends on it: drop the class and delete
    // the matching block in `main.css` and the pane is exactly what it was.
    <div className="lore-quest-log-facets relative flex h-full w-full flex-1 flex-col gap-2">
      {/* Top bar: full-width, no nested card. Title + count on the left,
          action buttons clustered tight on the right. */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <BookOpen className="text-muted-foreground size-4 shrink-0" />
        <span className="text-xs font-medium">{tr("quest-log.quests")}</span>
        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[11px]">
          {filteredQuests.length}/25
        </span>
        <div className="ml-auto flex items-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={toggleAll}
                  aria-label={
                    collapseSignal.collapsed
                      ? tr("quest-log.expand-all" as never)
                      : tr("quest-log.collapse-all" as never)
                  }
                />
              }
            >
              {collapseSignal.collapsed ? (
                <ChevronsUpDown className="size-3.5" />
              ) : (
                <ChevronsDownUp className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {collapseSignal.collapsed
                ? tr("quest-log.expand-all" as never)
                : tr("quest-log.collapse-all" as never)}
            </TooltipContent>
          </Tooltip>
          {/* Deliberately NOT a chevron. The button to its left toggles the
              quest GROUPS and is already a double-chevron; a second chevron
              beside it would read as one control with two directions rather
              than two controls with different subjects. A panel icon says the
              subject is the pane itself. */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  data-testid="quest-log-collapse"
                  onClick={props.onCollapse}
                  aria-label={tr("quest-log.collapse-panel" as never)}
                />
              }
            >
              <PanelLeftClose className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              {tr("quest-log.collapse-panel" as never)}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex px-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            disabled={quests.length === 0}
            placeholder={tr("quest-log.search")}
            value={searchValue}
            onChange={handleSearchChange}
            className="h-8 rounded-full pr-8 pl-7 text-xs"
          />
          {searchValue && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearSearch}
              className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        <QuestList quests={filteredQuests} collapseSignal={collapseSignal} />
      </div>
    </div>
  );
};

export default QuestLog;
