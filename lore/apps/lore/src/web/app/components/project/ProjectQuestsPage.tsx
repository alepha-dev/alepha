import { useStore } from "alepha/react";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import ProjectQuestsTable from "./ProjectQuestsTable.tsx";

/**
 * The Quests page: the grouped quest table, and nothing else.
 *
 * It used to render the Kanban board instead when `questsViewAtom` said so,
 * which is what made the board a *mode* rather than a place. The board is
 * `projectKanban` at `/:projectSlug/kanban` now, and a bare `/:projectSlug`
 * always lands here. (For a while `project.defaultSurface` could send it to
 * the board through this route's loader; that setting went with feedback
 * #2066.)
 *
 * The view bar that switches the two lives in `ProjectView`, not here
 * (#153): a page rendered as the `NestedView` is necessarily to the RIGHT
 * of the quest log, and the bar switches the whole surface, not the table
 * inside it.
 */
const ProjectQuestsPage = () => {
  const [project] = useStore(currentProjectAtom);

  if (!project) {
    return null;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ProjectQuestsTable />
    </div>
  );
};

export default ProjectQuestsPage;
