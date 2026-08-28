import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Columns3, List } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";

/**
 * The two surfaces a project's quests can be read on.
 *
 * This used to be the schema of `questsViewAtom`, a cookie holding which one
 * the Quests page rendered. Both are routes now, so the only thing left that
 * needs the union is this bar. The per-project preference for which one a
 * bare `/:projectSlug` lands on is `project.defaultSurface`.
 */
export type QuestsView = "list" | "kanban";

export interface ProjectQuestsViewSwitcherProps {
  /**
   * The surface currently open, or `undefined` on a route that is neither —
   * the quest detail page, where both entries are live links back up to a
   * list rather than a pressed state.
   */
  view: QuestsView | undefined;
  /**
   * `false` when the project has the kanban feature off — the bar then
   * renders nothing at all rather than a single dead entry, and no empty
   * band where it was.
   */
  kanbanEnabled: boolean;
  onSelect: (view: QuestsView) => void;
}

/**
 * The horizontal bar across the top of the project content area, switching
 * between the quest table and the Kanban board.
 *
 * It was once the ONLY way to reach the board: the 2026-08 rename turned
 * kanban from its own route into a view of the Quests page and took the
 * sidebar entry with it. The board is `projectKanban` again, with an entry
 * of its own, so the bar is a convenience rather than the sole door — kept
 * because switching surfaces is a one-click gesture people expect next to
 * the content, not a trip to the sidebar. Its buttons navigate; nothing is
 * stored, and there is no `?view=` (see #156).
 *
 * Rendered by `ProjectView`, as the first child of the content area and
 * OUTSIDE its `showQuestLog / fullWidth / else` branch (#153). It first lived
 * inside the Quests page, which put it between the quest log and the table
 * and made it read as a control for the table; the branch is the reason it
 * cannot simply be moved within the page — anything a `NestedView` renders is
 * necessarily right of the log. Staying outside the branch is what keeps the
 * bar's position identical whether the layout shows the quest log, goes full
 * width under the board, or centers a column. It was a vertical rail down the
 * far-left edge until #163; the invariant survives with its axis rotated —
 * being above the branch gives it a stable y for free.
 *
 * The entries carry visible labels rather than bare icons. A full-width band
 * holding two icon buttons reads as unfinished in a way a narrow rail did not,
 * and the horizontal space makes the labels affordable. `Segmented` would give
 * the same shape, but it is a `radiogroup` — it would trade `aria-pressed` for
 * `aria-checked` and offers nowhere to hang the per-entry test ids the e2e
 * suite drives this control by.
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
    { view: "list", icon: List, label: String(tr("board.view.list")) },
    { view: "kanban", icon: Columns3, label: String(tr("board.view.kanban")) },
  ];

  return (
    <div
      data-testid="quests-view-switcher"
      className="border-border flex shrink-0 flex-row items-center gap-1 border-b px-2 py-1"
    >
      {entries.map((entry) => (
        <Button
          key={entry.view}
          variant={props.view === entry.view ? "secondary" : "ghost"}
          size="sm"
          aria-label={entry.label}
          aria-pressed={props.view === entry.view}
          data-testid={`quests-view-${entry.view}`}
          onClick={() => props.onSelect(entry.view)}
        >
          <entry.icon className="size-4" />
          {entry.label}
        </Button>
      ))}
    </div>
  );
};

export default ProjectQuestsViewSwitcher;
