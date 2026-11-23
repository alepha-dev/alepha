import { reportsUrlSchema } from "@lore/core/schemas";
import {
  $pageProject,
  $pageProjectSettings,
  canInProject,
  capabilityOption,
  CoreRouter,
  currentProjectAtom,
  hasCapability,
  ReportsTabRegistry,
  ReportsUrlQuery,
} from "@lore/core/web";
import { $inject, Alepha, z } from "alepha";
import { $page, NotFound, ReactRouter, Redirection } from "alepha/react/router";
import { isHttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { CodeBrowserController } from "../../api/controllers/CodeBrowserController.ts";
import type { CodeRepositoryController } from "../../api/controllers/CodeRepositoryController.ts";
import type { QualityReportsController } from "../../api/controllers/QualityReportsController.ts";
import { currentCodeRepoAtom } from "./atoms/currentCodeRepoAtom.ts";

/**
 * Build's pages: Reports' Quality tab, moved from Ship with the same route
 * name and URL (#E162), and the code browser under `/<project>/code`
 * (#E167).
 */
export class BuildRouter {
  core = $inject(CoreRouter);
  alepha = $inject(Alepha);
  router = $inject(ReactRouter);
  qualityApi = $client<QualityReportsController>();
  repoApi = $client<CodeRepositoryController>();
  codeApi = $client<CodeBrowserController>();
  reportsUrl = $inject(ReportsUrlQuery);
  reportsTabs = $inject(ReportsTabRegistry);

  /**
   * Coverage and test totals pushed by CI, a tab of its own (#Q3070) after a
   * day as the last section of Delivery (#Q3010). The one Reports tab whose
   * data is INGESTED rather than derived, hence its empty state.
   */
  reportsQuality = $page({
    parent: this.core.projectReports,
    name: "reportsQuality",
    prefetch: true,
    path: "/quality",
    schema: { query: reportsUrlSchema },
    lazy: () =>
      import("./components/project/reports/ReportsQuality.client.tsx"),
    loader: async ({ query }) => ({
      url: query,
      quality: await this.qualityApi.getReportsQuality({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
        query: this.reportsUrl.toQuery(
          query,
          this.reportsTabs.honours("reportsQuality"),
        ),
      }),
    }),
  });

  /**
   * General > Quality (#Q4059): the coverage target and the coverage alert,
   * out of Ship's settings. Listed by `BuildShell` while `quality` is on.
   */
  projectSettingsQuality = $pageProjectSettings({
    name: "projectSettingsQuality",
    path: "/quality",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Quality`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsQualityPage.tsx"),
  });

  /**
   * The project, or a 404 (#Q4133, review #130 item 1): every code page
   * needs Build with `repositories` on and `code:read`, and answers a page
   * that does not exist otherwise. ⚠️ An OPTION guarding a route, the
   * documented exception of `route-capability-guards.spec.ts`: git smart
   * HTTP 404s on the same switch, and the API does too.
   */
  protected requireCode() {
    const project = this.alepha.store.get(currentProjectAtom);
    if (
      !project ||
      !hasCapability(project, "build") ||
      !capabilityOption(project, "build", "repositories") ||
      !canInProject(project, "code:read")
    ) {
      throw new NotFoundError("Code is not enabled for this project");
    }
    return project;
  }

  /**
   * `/<project>/code`: the repositories, or the one repository itself when
   * the project has only one, so `/alepha/code` opens this repository.
   */
  projectCode = $pageProject({
    name: "projectCode",
    path: "/code",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Code`,
    }),
    lazy: () => import("./components/project/code/CodeRepositories.tsx"),
    loader: async () => {
      const project = this.requireCode();
      const { repositories } = await this.repoApi.listCodeRepositories({
        params: { projectId: project.id },
      });
      if (repositories.length === 1) {
        throw new Redirection({
          redirect: this.router.path("codeRepoHome", {
            params: {
              projectSlug: project.slug,
              repoSlug: repositories[0]!.slug,
            },
          }),
        });
      }
      return { repositories };
    },
  });

  /**
   * One repository's shell, `/<project>/code/:repoSlug`: a plate over the
   * tabs #E167's pages mount under.
   */
  projectCodeRepo = $pageProject({
    name: "projectCodeRepo",
    path: "/code/:repoSlug",
    schema: { params: z.object({ repoSlug: z.text() }) },
    children: () => [this.codeRepoHome],
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Code`,
    }),
    lazy: () => import("./components/project/code/CodeRepoLayout.tsx"),
    loader: async ({ params }) => {
      const project = this.requireCode();
      const detail = await this.codeApi.getCodeRepository({
        params: { projectId: project.id, slug: params.repoSlug },
      });
      this.alepha.store.set(currentCodeRepoAtom, detail);
      return {};
    },
    onLeave: () => {
      this.alepha.store.set(currentCodeRepoAtom, undefined);
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * The repository's first tab: its last commit and how to clone it.
   */
  codeRepoHome = $page({
    name: "codeRepoHome",
    path: "/",
    lazy: () => import("./components/project/code/CodeRepoHome.tsx"),
  });
}
