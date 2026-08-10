import { useClient, useStore } from "alepha/react";
import { useEffect, useState } from "react";
import type { KanbanController } from "@/api/controllers/KanbanController.ts";
import {
  defaultProjectFeatures,
  type ProjectFeatures,
} from "@/api/entities/projects.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { questsViewAtom } from "../../atoms/questsViewAtom.ts";
import KanbanBoard from "../kanban/KanbanBoard.tsx";
import ProjectQuestsTable from "./ProjectQuestsTable.tsx";

/**
 * The Quests page. Renders the grouped table, or the kanban board when
 * `questsViewAtom` says so.
 *
 * The view used to live in `?view=kanban`, seeded from `localStorage` by an
 * effect in this component. That effect is gone with the param (#156) — see
 * `questsViewAtom` for why the URL could not hold this state safely. Kanban
 * data is still fetched here on demand rather than in the route loader:
 * `projectQuests` has no loader of its own (the parent `project` route
 * already fetches everything the table needs), and the loader machinery
 * does not re-run on a state-only change anyway, so a loader-fetched board
 * would be stale on the first toggle.
 *
 * The icon rail that switches the two lives in `ProjectView`, not here
 * (#153): a page rendered as the `NestedView` is necessarily to the RIGHT of
 * the quest log, and the rail switches the whole surface, not the table
 * inside it.
 */
const ProjectQuestsPage = () => {
  const [project] = useStore(currentProjectAtom);
  const [questsView] = useStore(questsViewAtom);
  const kanbanApi = useClient<KanbanController>();
  const [quests, setQuests] = useState<QuestResource[] | undefined>(undefined);

  const features: ProjectFeatures = {
    ...defaultProjectFeatures,
    ...project?.features,
  };
  // The stored view outlives the feature toggle, so an owner who turns
  // kanban off must not be left on a board they can no longer switch away
  // from — the rail is hidden in that state.
  const kanban = questsView.view === "kanban" && features.kanban === true;

  useEffect(() => {
    if (!kanban || !project) {
      return;
    }
    let cancelled = false;
    kanbanApi
      .getBoard({ params: { projectId: project.id } })
      .then((board) => {
        if (!cancelled) {
          setQuests(board.quests);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuests([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kanban, project?.id]);

  if (!project) {
    return null;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {kanban ? (
        quests ? (
          <KanbanBoard project={project} quests={quests} />
        ) : null
      ) : (
        <ProjectQuestsTable />
      )}
    </div>
  );
};

export default ProjectQuestsPage;
