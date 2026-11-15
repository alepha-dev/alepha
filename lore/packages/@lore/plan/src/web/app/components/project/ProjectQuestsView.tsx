import { useStore } from "alepha/react";

import { questsViewAtom } from "../../atoms/questsViewAtom.ts";
import ProjectKanbanPage from "./ProjectKanbanPage.tsx";
import ProjectQuestsTable from "./ProjectQuestsTable.tsx";

/**
 * The body of `/quests`: the quests table or the board, whichever the
 * reader last chose on the List | Board tabs (`questsViewAtom`).
 *
 * Both views live on the one route, so the URL, the breadcrumb and the
 * sidebar entry stay the same whichever is showing. The table's URL filters
 * (`?status=`, `?tag=`, ...) only apply to the List.
 */
const ProjectQuestsView = () => {
  const [{ view }] = useStore(questsViewAtom);

  return view === "board" ? <ProjectKanbanPage /> : <ProjectQuestsTable />;
};

export default ProjectQuestsView;
