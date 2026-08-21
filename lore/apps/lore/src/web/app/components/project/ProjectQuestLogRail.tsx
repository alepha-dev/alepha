import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { BookOpen, PanelLeftOpen } from "lucide-react";
import type { ReactElement } from "react";

import { currentAssignedQuestsAtom } from "../../atoms/currentAssignedQuestsAtom.ts";
import type { I18n } from "../../services/I18n.ts";

export interface ProjectQuestLogRailProps {
  onExpand: () => void;
}

/**
 * What the Quest Log leaves behind when it is collapsed: a rail one button
 * wide, carrying the control that brings the pane back.
 *
 * Collapsing to nothing at all was never on the table — the same reasoning
 * `FolioInspectorRail` records applies here. A pane that can be closed has to
 * say how to reopen it, or the only routes back are a menu that does not
 * advertise itself and a preference the reader cannot see.
 *
 * The whole rail is the button rather than a small target inside it: at 32px
 * there is no room for a hit area smaller than the strip, and the count above
 * it is not separately actionable.
 *
 * It reads `currentAssignedQuestsAtom` itself rather than taking the number as
 * a prop. `ProjectView` does not otherwise touch that atom, and threading a
 * count through it purely so this rail can render one badge would put quest
 * data in the layout component for no other reason.
 */
const ProjectQuestLogRail = (props: ProjectQuestLogRailProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [quests = []] = useStore(currentAssignedQuestsAtom);
  const label = String(tr("quest-log.expand-panel"));

  return (
    <button
      type="button"
      data-testid="quest-log-rail"
      onClick={props.onExpand}
      aria-label={label}
      title={label}
      // Same EXPERIMENT as the open pane (`main.css`), so collapsing the log
      // does not change what it is made of. The `-rail` half only rescales
      // the tile to fit 32px. `hover:bg-accent` still works under it: the
      // lattice is a `z-index: -1` pseudo, so it sits above the button's own
      // background and below its icons.
      className="lore-quest-log-facets lore-quest-log-facets-rail border-border text-muted-foreground hover:text-foreground hover:bg-accent flex w-8 flex-none flex-col items-center gap-2 border-r pt-3 transition-colors"
    >
      <BookOpen className="size-4 shrink-0" />
      {/* The count is the one thing worth keeping visible while the pane is
          shut: it is why someone opens the log in the first place. Hidden at
          zero rather than rendered as "0" — an empty badge on a collapsed pane
          is noise about nothing. */}
      {quests.length > 0 && (
        <span className="bg-muted text-muted-foreground rounded px-1 py-0.5 font-mono text-[10px] leading-none">
          {quests.length}
        </span>
      )}
      <PanelLeftOpen className="mt-auto mb-3 size-3.5 shrink-0" />
    </button>
  );
};

export default ProjectQuestLogRail;
