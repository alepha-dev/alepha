import { useClient, useQuery, useStore } from "alepha/react";
import { NestedView } from "alepha/react/router";
import { useEffect } from "react";

import type { KanbanController } from "@/api/controllers/KanbanController.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import KanbanBoard from "../kanban/KanbanBoard.tsx";
import { preloadQuestView } from "../project/quest/LazyQuestView.tsx";

/**
 * The Kanban board, at `/:projectSlug/kanban`.
 *
 * It was a *mode* of the Quests page until this route existed — no URL, no
 * sidebar entry, no way to link a card — which is what
 * `ProjectQuestsViewSwitcher` was invented to work around after the 2026-08
 * rename took the board's original entry away. With a real route, the
 * `kanbanView` special case in `ProjectView` collapses into the same
 * machinery that already serves Epics, Folios and Blights.
 *
 * The board is still fetched here rather than in a route loader. `getBoard`
 * returns a different shape than the `project` layout's quest fetch (it is
 * backlog-gated and drops shelved rows server-side), and keeping the fetch
 * in the component is what lets `KanbanBoard` own its own reload — the
 * header's create button bumps `kanbanReloadAtom` and the board refetches
 * without a navigation.
 */
const ProjectKanbanPage = () => {
  const [project] = useStore(currentProjectAtom);
  const kanbanApi = useClient<KanbanController>();

  // Every card on this board opens `QuestView` behind a chunk boundary.
  // Fetching that chunk while the board is being read is what keeps the
  // boundary invisible: by the time a card is clicked it is already there.
  useEffect(() => {
    preloadQuestView();
  }, []);

  // The board's first read, a `useQuery` (#E59, #Q2331). Keyless on purpose:
  // `KanbanBoard` seeds its own state from this once and fetches itself from
  // then on, so a cached board handed to a remount would be a stale seed.
  // The answer carries the project it was read for, so a project switch
  // never seeds one project's board with another's cards.
  //
  // A failed read toasts now, and the board still renders, empty, as it did:
  // its own reload is one gesture away.
  const boardQuery = useQuery(
    {
      enabled: !!project,
      handler: async () => ({
        projectId: project?.id,
        quests: (
          await kanbanApi.getBoard({
            params: { projectId: project?.id as number },
          })
        ).quests,
      }),
    },
    [kanbanApi, project?.id],
  );
  const quests: QuestResource[] | undefined =
    boardQuery.data?.projectId === project?.id
      ? boardQuery.data?.quests
      : boardQuery.error
        ? NO_QUESTS
        : undefined;

  if (!project || !quests) {
    return null;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <KanbanBoard project={project} quests={quests} />
      {/*
        The open card, when there is one (`projectKanbanCard` at
        `/kanban/:shortId`). It renders a sheet over this board, and the
        board stays mounted underneath — which is the reason the card is a
        CHILD route rather than a sibling: a sibling would remount and
        refetch the whole board every time a card opened.
      */}
      <NestedView />
    </div>
  );
};

export default ProjectKanbanPage;

/**
 * The board a failed first read renders: empty, with its own reload one
 * gesture away.
 */
const NO_QUESTS: QuestResource[] = [];
