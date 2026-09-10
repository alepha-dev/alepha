import { z } from "alepha";
import { $head } from "alepha/react/head";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

import type { LoomController } from "../api/controllers/LoomController.ts";
import type { Project } from "../api/schemas/projectSchema.ts";
import { Workbench } from "./components/Workbench.tsx";

/**
 * Two routes, one shell. The selected project lives in the URL rather than in
 * storage, so a reload, a bookmark and a second window all land on it.
 *
 * Both routes load the project list on the server, so the side bar arrives
 * rendered. A project's state is collected in the browser instead: it runs
 * git in every worktree, and the shell should not wait for it.
 */
export class AppRouter {
  protected readonly api = $client<LoomController>();

  /**
   * Loom is dark only, as an IDE is. The class has to be on `<html>` from the
   * first byte, and page heads arrive after the early flush, so it is set
   * here, globally.
   */
  head = $head({
    htmlAttributes: { class: "dark" },
    link: [{ rel: "icon", href: "/logo.svg", type: "image/svg+xml" }],
  });

  home = $page({
    path: "/",
    head: { title: "Loom" },
    loader: async () => ({ projects: await this.api.listProjects() }),
    component: Workbench,
  });

  project = $page({
    path: "/projects/:projectId",
    schema: {
      params: z.object({ projectId: z.text() }),
    },
    head: (props) => ({
      title: `${props.projects.find((it: Project) => it.id === props.projectId)?.name ?? props.projectId} · Loom`,
    }),
    loader: async ({ params }) => ({
      projects: await this.api.listProjects(),
      projectId: params.projectId,
    }),
    component: Workbench,
  });
}
