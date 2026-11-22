import { PaneResizer } from "@alepha/ui";
import { useStore } from "alepha/react";
import { lazy, Suspense, useState } from "react";

import { questLogCollapsedAtom } from "../../atoms/questLogCollapsedAtom.ts";
import ProjectQuestLogRail from "./ProjectQuestLogRail.tsx";
import QuestLogSkeleton from "./QuestLogSkeleton.tsx";

/**
 * The quest log beside the Quests pages, registered on core's
 * `ProjectShellRegistry` by `WorkShell` (#E75, #Q2624), so `ProjectView`
 * names no quest component.
 *
 * Resizable by its right edge through the shared `PaneResizer`: drag to set
 * the width, double-click to go back to the default. The width is kept in `questLogCollapsedAtom` beside
 * the collapsed flag, so both survive a reload. A handle on the pane rather
 * than a `ResizablePanelGroup`: the shell renders this pane and the page as
 * siblings, and a panel group would have to own both.
 *
 * Collapsed, the pane becomes a rail, but BOTH carry the same `hidden lg:flex`
 * gate. Below `lg` the quest log does not render at all, so a rail without
 * that gate would introduce 36px of chrome on mobile where there is
 * otherwise nothing, and a control that expands a pane the viewport then
 * refuses to show.
 */
const ProjectQuestLogAside = () => {
  const [state, setState] = useStore(questLogCollapsedAtom);
  // The width while dragging, so a drag repaints without writing the cookie
  // on every pointer move. Written to the atom once, on release.
  const [dragWidth, setDragWidth] = useState<number | undefined>();

  if (state.collapsed) {
    return (
      <div className="hidden min-h-0 lg:flex">
        <ProjectQuestLogRail
          onExpand={() => setState({ ...state, collapsed: false })}
        />
      </div>
    );
  }

  const width = dragWidth ?? state.width ?? DEFAULT_WIDTH;

  return (
    <div
      data-testid="quest-log"
      className="chrome relative hidden min-h-0 shrink-0 lg:flex"
      style={{ width }}
    >
      {/* The list is the lazy part; the frame around it already holds its
          width, and the skeleton its shape, so nothing moves when it
          arrives. */}
      <Suspense fallback={<QuestLogSkeleton />}>
        <QuestLog onCollapse={() => setState({ ...state, collapsed: true })} />
      </Suspense>
      {/* The shared handle, which the folio tree uses too. */}
      <PaneResizer
        width={state.width ?? DEFAULT_WIDTH}
        minWidth={MIN_WIDTH}
        maxWidth={MAX_WIDTH}
        defaultWidth={DEFAULT_WIDTH}
        onResize={setDragWidth}
        onWidth={(next) => {
          setDragWidth(undefined);
          setState({ ...state, width: next });
        }}
      />
    </div>
  );
};

/**
 * The log itself, in its own chunk: the frame above loads with the shell.
 */
const QuestLog = lazy(() => import("./QuestLog.tsx"));

/**
 * The pane's width bounds and default, in pixels. Narrower than 240 cuts
 * every title to a few words; wider than 560 takes more from the page than
 * a list of titles is worth.
 */
const MIN_WIDTH = 240;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 300;

export default ProjectQuestLogAside;
