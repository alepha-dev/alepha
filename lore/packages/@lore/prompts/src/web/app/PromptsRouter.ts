import {
  $pageProject,
  $pageProjectSettings,
  currentProjectAtom,
  hasCapability,
  HostRouter,
  ProjectPageSkeleton,
} from "@lore/core/web";
import { $inject, Alepha, z } from "alepha";
import { $page } from "alepha/react/router";
import { NotFoundError } from "alepha/server";

/**
 * The pages of `@lore/prompts` (#E175), each mounted under core's project
 * layout with `$pageProject` / `$pageProjectSettings`, so no router names
 * another module's page. Each answers 404 while the project has the
 * `prompts` capability off.
 */
export class PromptsRouter {
  alepha = $inject(Alepha);
  hosts = $inject(HostRouter);

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
    loader: async () => this.gate(),
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
    loader: async () => this.gate(),
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
      this.gate();
      return { jobId: params.jobId };
    },
  });

  /**
   * One prompt (#Q4326), on the detail shell a job uses: its words, and
   * beside them its args, trigger, pins and last run. Opened from Settings >
   * Prompts; every member reads it, as the list.
   */
  projectPrompt = $pageProject({
    loading: ProjectPageSkeleton,
    name: "projectPrompt",
    path: "/prompts/:name",
    nav: { hidden: true, label: "Prompt" },
    schema: { params: z.object({ name: z.string() }) },
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Prompt`,
    }),
    lazy: () => import("./components/ProjectPrompt.tsx"),
    loader: async ({ params }) => {
      this.gate();
      return { name: params.name };
    },
  });

  /**
   * A host's Jobs tab (#Q4524): every job of the machine, whatever its
   * project, a tab of core's host console.
   *
   * ⚠️ No capability gate, unlike every other page here: the console is a
   * page of the host's HOME project, which may have Prompts off while it
   * lends the machine to a project that has it on. The read is gated
   * server-side, on `host:read` in the home project.
   */
  bayJobs = $page({
    parent: this.hosts.bay,
    name: "bayJobs",
    nav: { hidden: true, label: "Jobs" },
    path: "/jobs",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Jobs`,
    }),
    lazy: () => import("./components/bay/BayJobs.tsx"),
  });

  /**
   * What every page of Prompts requires: the project, with the capability
   * on. 404, never 403, as the other modules' pages answer.
   */
  protected gate() {
    const project = this.alepha.store.get(currentProjectAtom);
    if (!project) {
      throw new NotFoundError("Project not found");
    }
    if (!hasCapability(project, "prompts")) {
      throw new NotFoundError("Prompts is not enabled for this project");
    }
    return {};
  }
}
