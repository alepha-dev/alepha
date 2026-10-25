import { useStore } from "alepha/react";

import { questLogCollapsedAtom } from "../../atoms/questLogCollapsedAtom.ts";
import ProjectQuestLogRail from "./ProjectQuestLogRail.tsx";
import QuestLog from "./QuestLog.tsx";

/**
 * The quest log beside the Quests pages, registered on core's
 * `ProjectShellRegistry` by `WorkShell` (#E75, #Q2624), so `ProjectView`
 * names no quest component.
 *
 * Collapsed, the pane becomes a rail, but BOTH carry the same `hidden lg:flex`
 * gate. Below `lg` the quest log does not render at all, so a rail without
 * that gate would introduce 32px of chrome on mobile where there is
 * otherwise nothing, and a control that expands a pane the viewport then
 * refuses to show.
 */
const ProjectQuestLogAside = () => {
  const [questLogCollapsed, setQuestLogCollapsed] = useStore(
    questLogCollapsedAtom,
  );

  if (questLogCollapsed.collapsed) {
    return (
      <div className="hidden min-h-0 lg:flex">
        <ProjectQuestLogRail
          onExpand={() => setQuestLogCollapsed({ collapsed: false })}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="quest-log"
      className="border-border hidden min-h-0 shrink-0 border-r lg:flex"
      style={{ width: "25%", minWidth: 240, maxWidth: 420 }}
    >
      <QuestLog onCollapse={() => setQuestLogCollapsed({ collapsed: true })} />
    </div>
  );
};

export default ProjectQuestLogAside;
