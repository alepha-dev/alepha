import { useStore } from "alepha/react";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import ProjectQuestsTable from "./ProjectQuestsTable.tsx";

/**
 * The Quests page: the grouped quest table, and nothing else.
 *
 * It used to render the Kanban board instead when `questsViewAtom` said so,
 * which is what made the board a *mode* rather than a place. The board is
 * `projectKanban` at `/:projectSlug/kanban` now, and which surface a bare
 * `/:projectSlug` lands on is `project.defaultSurface`, applied by this
 * route's loader as a redirect rather than by a branch here.
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
