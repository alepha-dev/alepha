import { useStore } from "alepha/react";
import { lazy, Suspense, useRef, useState } from "react";

import { questLogCollapsedAtom } from "../../atoms/questLogCollapsedAtom.ts";
import ProjectQuestLogRail from "./ProjectQuestLogRail.tsx";
import QuestLogSkeleton from "./QuestLogSkeleton.tsx";

/**
 * The quest log beside the Quests pages, registered on core's
 * `ProjectShellRegistry` by `WorkShell` (#E75, #Q2624), so `ProjectView`
 * names no quest component.
 *
 * Resizable by its right edge: drag to set the width, double-click to go
 * back to the default. The width is kept in `questLogCollapsedAtom` beside
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
  const drag = useRef<{ startX: number; startWidth: number } | undefined>(
    undefined,
  );

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
      className="bg-sidebar/40 relative hidden min-h-0 shrink-0 lg:flex"
      style={{ width }}
    >
      {/* The list is the lazy part; the frame around it already holds its
          width, and the skeleton its shape, so nothing moves when it
          arrives. */}
      <Suspense fallback={<QuestLogSkeleton />}>
        <QuestLog onCollapse={() => setState({ ...state, collapsed: true })} />
      </Suspense>
      {/* The resize handle: a hairline on the pane's edge with a wider
          invisible grab area, which turns into an accent line on hover and
          while dragging. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        data-testid="quest-log-resize"
        data-dragging={dragWidth !== undefined || undefined}
        // Focusable, and the arrow keys resize, so the handle is not
        // pointer-only.
        tabIndex={0}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowLeft"
              ? -16
              : event.key === "ArrowRight"
                ? 16
                : 0;
          if (step !== 0) {
            event.preventDefault();
            setState({ ...state, width: clamp(width + step) });
          }
        }}
        className="group/resize focus-visible:ring-ring/50 absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none focus-visible:ring-2 focus-visible:outline-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { startX: event.clientX, startWidth: width };
          setDragWidth(width);
        }}
        onPointerMove={(event) => {
          if (!drag.current) {
            return;
          }
          setDragWidth(
            clamp(
              drag.current.startWidth + event.clientX - drag.current.startX,
            ),
          );
        }}
        onPointerUp={() => {
          if (drag.current && dragWidth !== undefined) {
            setState({ ...state, width: dragWidth });
          }
          drag.current = undefined;
          setDragWidth(undefined);
        }}
        onDoubleClick={() => setState({ collapsed: false })}
      >
        <span className="bg-border group-hover/resize:bg-primary/60 group-data-[dragging]/resize:bg-primary absolute inset-y-0 right-0 w-px transition-colors group-hover/resize:w-0.5 group-data-[dragging]/resize:w-0.5" />
      </div>
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

const clamp = (value: number) =>
  Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)));

export default ProjectQuestLogAside;
