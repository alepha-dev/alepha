import { PaneRail } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { BookOpen } from "lucide-react";
import type { ReactElement } from "react";

import { currentAssignedQuestsAtom } from "../../atoms/currentAssignedQuestsAtom.ts";

export interface ProjectQuestLogRailProps {
  onExpand: () => void;
}

/**
 * What the Quest Log leaves behind when it is collapsed: the kit's
 * `PaneRail`, with the log's icon and its count.
 *
 * Collapsing to nothing at all was never on the table: the same reasoning
 * `FolioInspectorRail` records applies here. A pane that can be closed has to
 * say how to reopen it, or the only routes back are a menu that does not
 * advertise itself and a preference the reader cannot see.
 *
 * Built on `PaneRail` since #Q3206, so it is the same 36px strip, the whole
 * of it the button, as the folio tree's and inspector's rails.
 *
 * It reads `currentAssignedQuestsAtom` itself rather than taking the number as
 * a prop. `ProjectView` does not otherwise touch that atom, and threading a
 * count through it purely so this rail can render one badge would put quest
 * data in the layout component for no other reason.
 */
const ProjectQuestLogRail = (props: ProjectQuestLogRailProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [quests = []] = useStore(currentAssignedQuestsAtom);

  return (
    <PaneRail
      side="left"
      label={tr("quest-log.expand-panel")}
      onExpand={props.onExpand}
      data-testid="quest-log-rail"
      icon={<BookOpen className="size-4 shrink-0" />}
      // Same EXPERIMENT as the open pane (`main.css`), so collapsing the log
      // does not change what it is made of. The `-rail` half only rescales
      // the tile to fit the strip. `hover:bg-hover` still works under it: the
      // lattice is a `z-index: -1` pseudo, so it sits above the button's own
      // background and below its icons.
      className="lore-quest-log-facets lore-quest-log-facets-rail"
    >
      {/* The count is the one thing worth keeping visible while the pane is
          shut: it is why someone opens the log in the first place. Hidden at
          zero rather than rendered as "0": an empty badge on a collapsed pane
          is noise about nothing. */}
      {quests.length > 0 && (
        <span className="bg-muted text-muted-foreground rounded px-1 py-0.5 font-mono text-[10px] leading-none">
          {quests.length}
        </span>
      )}
    </PaneRail>
  );
};

export default ProjectQuestLogRail;
