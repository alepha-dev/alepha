import { useRouter } from "alepha/react/router";

import PromptJobsTable from "./PromptJobsTable.tsx";

/**
 * Settings > Prompts > Jobs (#Q4281): the project's jobs in the prompt jobs
 * table. A job belongs to the project, not to a host: no host page lists
 * them. `?prompt=` opens it filtered on one prompt.
 */
const ProjectSettingsPromptJobsPage = () => {
  const router = useRouter();
  const asked = (router.query as Record<string, unknown>).prompt;
  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col md:-m-6">
      <PromptJobsTable
        className="min-h-0 flex-1"
        {...(typeof asked === "string" ? { seedPrompt: asked } : {})}
      />
    </div>
  );
};

export default ProjectSettingsPromptJobsPage;
