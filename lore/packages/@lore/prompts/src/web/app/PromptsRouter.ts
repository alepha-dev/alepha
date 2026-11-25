import {
  $pageProject,
  $pageProjectSettings,
  ProjectPageSkeleton,
} from "@lore/core/web";
import { z } from "alepha";

/**
 * The pages of `@lore/prompts` (#E175), each mounted under core's project
 * layout with `$pageProject` / `$pageProjectSettings`, so no router names
 * another module's page.
 */
export class PromptsRouter {
  /**
   * Settings > Prompts, its Prompts tab (#Q4280): the built-ins and the
   * project's custom prompts, open to every member.
   */
  projectSettingsPrompts = $pageProjectSettings({
    name: "projectSettingsPrompts",
    path: "/prompts",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Prompts`,
    }),
    lazy: () => import("./components/settings/ProjectSettingsPromptsPage.tsx"),
  });

  /**
   * Settings > Prompts > Jobs (#Q4281): the project's jobs, filtered by
   * prompt, status and host. Listed with `host:read`, the read it needs.
   */
  projectSettingsPromptJobs = $pageProjectSettings({
    name: "projectSettingsPromptJobs",
    path: "/prompts/jobs",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Jobs`,
    }),
    lazy: () =>
      import("./components/settings/ProjectSettingsPromptJobsPage.tsx"),
  });

  /**
   * One host job with its live log (#Q3984). The list is the Jobs tab of
   * Settings > Prompts (#Q4281): a job belongs to the project, not to a
   * host, and the reads are gated server-side on `host:read`. The path is
   * kept from core's (#E175): Plan's feedback links to it by URL.
   */
  projectJob = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectJob",
    path: "/jobs/:jobId",
    nav: { hidden: true, label: "Job" },
    schema: { params: z.object({ jobId: z.string() }) },
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Job`,
    }),
    lazy: () => import("./components/host-jobs/ProjectJob.tsx"),
    loader: async ({ params }) => {
      return { jobId: params.jobId };
    },
  });
}
