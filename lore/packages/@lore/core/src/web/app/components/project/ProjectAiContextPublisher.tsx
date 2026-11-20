import { useProjectAiContext } from "./useProjectAiContext.ts";

/**
 * Tells an assistant turn which project it is sent from (#Q3208). Renders
 * nothing.
 *
 * The project rides in the page context, never in the system prompt, because
 * a conversation outlives the page it started on: see `useProjectAiContext`,
 * which a narrower page calls with what it shows (#Q3972).
 *
 * Its own component, mounted by `ProjectView` past its early return, for the
 * reason `ProjectViewNavPublisher` is: its hooks only apply once a project is
 * loaded.
 */
const ProjectAiContextPublisher = () => {
  useProjectAiContext("project");
  return null;
};

export default ProjectAiContextPublisher;
