import { useClient, useStore } from "alepha/react";
import { useRouterState } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { KanbanController } from "@/api/controllers/KanbanController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import KanbanBoard from "../kanban/KanbanBoard.tsx";
import ProjectQuestsTable from "./ProjectQuestsTable.tsx";

/**
 * The Quests page. Renders the grouped table by default and the kanban
 * board when `?view=kanban`.
 *
 * The view lives in the URL rather than component state so a board link
 * still opens a board and the back button behaves. Kanban data is fetched
 * here on demand instead of in the route loader: `projectQuests` has no
 * loader of its own (the parent `project` route already fetches everything
 * the table needs), and the loader machinery does not re-run on a
 * query-only navigation anyway, so a loader-fetched board would be stale
 * on the first toggle.
 */
const ProjectQuestsPage = () => {
  const routerState = useRouterState();
  const [project] = useStore(currentProjectAtom);
  const kanbanApi = useClient<KanbanController>();
  const [quests, setQuests] = useState<QuestResource[] | undefined>(undefined);

  const kanban = routerState.query.view === "kanban";

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

  if (kanban) {
    return quests ? <KanbanBoard project={project} quests={quests} /> : null;
  }

  return <ProjectQuestsTable />;
};

export default ProjectQuestsPage;
