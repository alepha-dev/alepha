import { $inject, Alepha, z } from "alepha";
import { $page, NotFound } from "alepha/react/router";
import { isHttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { ProjectHostController } from "../../api/controllers/ProjectHostController.ts";
import { $pageProject, $pageProjectSettings } from "./$pageProject.ts";
import { currentHostAtom } from "./atoms/currentHostAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import ProjectPageSkeleton from "./components/project/ProjectPageSkeleton.tsx";

/**
 * The generic host's pages (#E166, folio #F1537): the host console with its
 * Overview, Commands and Settings tabs, the project's host jobs, and
 * Settings > Hosts. A module adds its own console tabs with `parent:
 * hosts.bay`, as Ship adds Processes. Names, paths and the `getHomeHost`
 * loader are what Ship's router had.
 */
export class HostRouter {
  alepha = $inject(Alepha);
  lendingApi = $client<ProjectHostController>();

  /**
   * The console for one `bay` host: what is running on the machine, what it
   * costs, and the buttons that act on it.
   *
   * ⚠️ **Under its home project, at `/:projectSlug/hosts/:hostSlug`.**
   * A host belongs to a project since #E126, so its console is a project
   * page, the way an app copy's is, and there is no account page for hosts
   * any more. It was `/account/hosts/:hostId`, removed with no redirect
   * (pre-v1). Every route here carries `nav: { hidden: true }`: the entry
   * point is the project's Settings ▸ Apps ▸ Hosts list.
   *
   * The param is the slug: a slug is unique per home project, so the pair
   * names one host. A project a host is only lent to never shows it
   * under its own slug: its rows link to the console under the home, which
   * answers 403 to anyone who is not a member there.
   *
   * ⚠️ `:hostSlug`, never `:slug` or `:id`: one param name per tree
   * position, the trap `projectApp` documents.
   */
  bay = $pageProject({
    loading: ProjectPageSkeleton,
    name: "bay",
    path: "/hosts/:hostSlug",
    schema: { params: z.object({ hostSlug: z.string() }) },
    head: (props, previous) => {
      const host = (props as { host?: { slug?: string } } | undefined)?.host;
      return {
        title: `${previous?.title ?? ""} › ${host?.slug ?? "Host"}`,
      };
    },
    lazy: () => import("./components/bay/BayLayout.tsx"),
    loader: async ({ params }) => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      // The refusal comes from the server: `getHomeHost` goes through this
      // project's gate, which answers 403 to a non-member and 404 to a slug
      // this project is not the home of, so a stranger gets a real refusal
      // for the whole subtree rather than an empty console.
      const host = await this.lendingApi.getHomeHost({
        params: { projectId: project.id, hostSlug: params.hostSlug },
      });
      this.alepha.store.set(currentHostAtom, host);
      return { host };
    },
    onLeave: () => {
      this.alepha.store.set(currentHostAtom, undefined);
    },
    errorHandler: (error) => {
      if (isHttpError(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  bayOverview = $page({
    parent: this.bay,
    name: "bayOverview",
    nav: { hidden: true, label: "Overview" },
    path: "/",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Overview`,
    }),
    lazy: () => import("./components/bay/BayOverview.tsx"),
  });

  bayCommands = $page({
    parent: this.bay,
    name: "bayCommands",
    nav: { hidden: true, label: "Commands" },
    path: "/commands",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Commands`,
    }),
    lazy: () => import("./components/bay/BayCommands.tsx"),
  });

  bayAgent = $page({
    parent: this.bay,
    name: "bayAgent",
    nav: { hidden: true, label: "Agent" },
    path: "/agent",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Agent`,
    }),
    lazy: () => import("./components/bay/BayAgent.tsx"),
  });

  baySettings = $page({
    parent: this.bay,
    name: "baySettings",
    nav: { hidden: true, label: "Settings" },
    path: "/settings",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Settings`,
    }),
    lazy: () => import("./components/bay/BaySettings.tsx"),
  });

  projectSettingsHosts = $pageProjectSettings({
    name: "projectSettingsHosts",
    path: "/hosts",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Hosts`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsHostsPage.tsx"),
  });
}
