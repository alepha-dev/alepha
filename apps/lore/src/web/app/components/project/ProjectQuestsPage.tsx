import { useClient, useStore } from "alepha/react";
import { useRouter, useRouterState } from "alepha/react/router";
import { useEffect, useState } from "react";
import type { KanbanController } from "@/api/controllers/KanbanController.ts";
import {
  defaultProjectFeatures,
  type ProjectFeatures,
} from "@/api/entities/projects.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import KanbanBoard from "../kanban/KanbanBoard.tsx";
import ProjectQuestsTable from "./ProjectQuestsTable.tsx";
import ProjectQuestsViewSwitcher from "./ProjectQuestsViewSwitcher.tsx";
import {
  type QuestsView,
  readStoredQuestsView,
  writeStoredQuestsView,
} from "./questsView.ts";

/**
 * The Quests page. Renders the grouped table by default and the kanban
 * board when `?view=kanban`, with an icon rail to switch between the two.
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
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const kanbanApi = useClient<KanbanController>();
  const [quests, setQuests] = useState<QuestResource[] | undefined>(undefined);

  const kanban = routerState.query.view === "kanban";

  const features: ProjectFeatures = {
    ...defaultProjectFeatures,
    ...project?.features,
  };
  const kanbanEnabled = features.kanban === true;

  // A bare `/p/:id/` adopts the last view this browser used. The rewrite is a
  // `replace` so it does not cost a history entry, and it writes the param
  // rather than tracking the view in state because `ProjectView` reads the
  // same query to go full width and drop the quest log under the board.
  useEffect(() => {
    if (routerState.query.view || !kanbanEnabled) {
      return;
    }
    if (readStoredQuestsView() === "kanban") {
      router.push("projectQuests", {
        query: { view: "kanban" },
        replace: true,
      });
    }
  }, [routerState.query.view, kanbanEnabled]);

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

  const selectView = (view: QuestsView) => {
    writeStoredQuestsView(view);
    router.push("projectQuests", { query: { view } });
  };

  return (
    <div className="flex min-h-0 flex-1">
      <ProjectQuestsViewSwitcher
        view={kanban ? "kanban" : "list"}
        kanbanEnabled={kanbanEnabled}
        onSelect={selectView}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {kanban ? (
          quests ? (
            <KanbanBoard project={project} quests={quests} />
          ) : null
        ) : (
          <ProjectQuestsTable />
        )}
      </div>
    </div>
  );
};

export default ProjectQuestsPage;
