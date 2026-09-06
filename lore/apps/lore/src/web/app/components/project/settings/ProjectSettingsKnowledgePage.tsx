import ProjectSettingsCapabilitySection from "./ProjectSettingsCapabilitySection.tsx";

/**
 * Knowledge: the capability and its one option.
 *
 * `agentSummary` reveals the "Summary for agents" field on a folio. Off by
 * default, and the reason is worth keeping: the summary is written for
 * `project_context` and `folio_list`, so for a human reading a folio it is
 * chrome between the title and the first line. Hiding it never stops it being
 * persisted - MCP keeps writing it, and turning the switch back on shows the
 * stored value unchanged.
 */
const ProjectSettingsKnowledgePage = () => (
  <ProjectSettingsCapabilitySection capability="knowledge" />
);

export default ProjectSettingsKnowledgePage;
