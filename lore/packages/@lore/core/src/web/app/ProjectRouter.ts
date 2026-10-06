import { inboxUnreadAtom } from "@alepha/ui/shell";
import { $inject, Alepha, z } from "alepha";
import type { NotificationInboxController } from "alepha/api/notifications";
import { $page, NotFound } from "alepha/react/router";
import { $secure } from "alepha/security";
import { HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { ProjectController } from "../../api/controllers/ProjectController.ts";
import type { ProjectPromptController } from "../../api/controllers/ProjectPromptController.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "./atoms/currentProjectMemberAtom.ts";
import { projectPromptsAtom } from "./atoms/projectPromptsAtom.ts";
import { ProjectLoaderRegistry } from "./registries/ProjectLoaderRegistry.ts";
import { capabilityOption } from "./services/projectCapabilities.ts";

/**
 * The two layouts every project page hangs under: `/:projectSlug` and its
 * `/settings`.
 *
 * They hold no `children` list. A page joins them by declaring `parent:`,
 * through `$pageProject` and `$pageProjectSettings`, so the layout never names
 * a page of another module (#E75, #Q2609): the `@lore` packages each declare
 * their own pages, and this class becomes `@lore/core/web`'s.
 *
 * ⚠️ Its own class, apart from `AppRouter`, for the cycle: `$pageProject`
 * injects this class, and a page of `AppRouter` calling it while `AppRouter`
 * is still being constructed would inject `AppRouter` into itself.
 */
export class ProjectRouter {
  protected readonly alepha = $inject(Alepha);
  protected readonly projectApi = $client<ProjectController>();
  protected readonly inboxApi = $client<NotificationInboxController>();
  protected readonly promptApi = $client<ProjectPromptController>();
  protected readonly loaders = $inject(ProjectLoaderRegistry);

  project = $page({
    /**
     * A **root-level** param: `/sds/quests/19`, not `/p/2/q/19`.
     *
     * The router walks static children before the param child and backtracks on
     * failure (`RouterProvider.search`), so `/auth/login`, `/new-project` and
     * `/oauth/continue` still win over this. `test/app-routes.spec.ts` asserts
     * every static root segment is also reserved in `ProjectSlugService`, so a
     * project can never claim one.
     *
     * ⚠️ The param is `projectSlug` here and in `projectFeedbackRequest`, which
     * shares this tree position. `RouterProvider.push` keeps ONE param name per
     * position — two routes naming it differently collapse onto one, the outer
     * wins, and the inner value arrives missing. Same trap documented on
     * `projectApp`'s `:app` and `:env`.
     */
    path: "/:projectSlug",
    // Every project surface is member-gated server-side, so nothing under here
    // is reachable anonymously. The guard turns an anonymous visitor away at the
    // router (instead of letting the loader 401 and the errorHandler catch it),
    // and puts the whole subtree in CSR — no HTML render a crawler will ever see.
    //
    // Consequence of the root-level param: an anonymous visitor who mistypes ANY
    // path now lands on the login page rather than a 404, because `/tpyo` matches
    // here. Unavoidable without a database round-trip ahead of the guard. A
    // signed-in visitor still gets a real 404 — see `errorHandler` below.
    use: [$secure()],
    schema: {
      params: z.object({
        projectSlug: z.string(),
      }),
    },
    head: (props) => {
      const project = (props as { project?: { title?: string } } | undefined)
        ?.project;
      return { title: project?.title ?? "Project" };
    },
    animation: ({ meta }) => {
      if (meta.firstOpen) {
        return {
          enter: {
            name: "projectOpen",
            duration: 500,
            timing: "cubic-bezier(0.16, 1, 0.3, 1)",
          },
        };
      }
    },
    lazy: () => import("./components/project/ProjectView.tsx"),
    loader: async ({ params }) => {
      // The one slug→id resolution in the app. Every fetch below — and every
      // endpoint any page under this layout calls — still takes the integer
      // id, read off `currentProjectAtom`. That is what keeps slug routing out
      // of the rest of the API surface.
      // `quests` is the narrow list kept on the response for published CLIs;
      // the full resources come from Work below.
      const {
        member,
        quests: _assignedWork,
        ...project
      } = await this.projectApi.getProjectBySlug({
        params: {
          slug: params.projectSlug,
        },
      });

      // Everything below needs only `project.id`, so it is issued together
      // rather than awaited in turn. That is not just parallelism: the
      // browser's `BatchCollector` coalesces action calls raised within a
      // 10ms window into ONE `POST /api/_batch`, and sequential awaits can
      // never share a window because each blocks on a full round trip.
      //
      // Each module's part of it is a registered contribution
      // (`ProjectLoaderRegistry`, #E75 #Q2624): this loader is core and names
      // no module's client. They run in the same `Promise.all`, so the batch
      // is unchanged, and write their atoms once everything has settled.
      const [, unreadEverywhere, prompts] = await Promise.all([
        this.loaders.load(project),

        // ⚠️ ONE inbox count, and it is deliberately the cross-project one.
        // Alepha and Odzala are open in the same session and a ping in one
        // must not be invisible from the other, so this passes NO scope. It
        // seeds `inboxUnreadAtom` before the first paint, which is what the
        // bell's own mount-fetch then does not have to do.
        //
        // A `count` action, never `list().items.length`: that is the bug
        // #1744 was, where a paged list capped the Feedback badge at 10 over
        // an inbox of 106.
        this.inboxApi
          .countInbox({ query: {} })
          .then((r) => r.unread)
          .catch(() => 0),

        // The agent prompt templates this project has customised, read here
        // so the copy can happen inside a click: Safari's transient
        // activation does not survive an `await` before `writeText`.
        //
        // Gated on the option, which is off by default, so a project that
        // does not use the feature pays no request.
        //
        // ⚠️ `{}` on failure and NOT `undefined`: the built-in defaults are
        // a complete answer, so a failed read is indistinguishable from a
        // project that has customised nothing, and the menus keep working.
        capabilityOption(project, "work", "agentPrompts")
          ? this.promptApi
              .getProjectPrompts({ params: { projectId: project.id } })
              .then((rows) =>
                Object.fromEntries(
                  rows.map((it) => [it.kind, it.template] as const),
                ),
              )
              .catch(() => ({}))
          : Promise.resolve({}),
      ]);

      this.alepha.store.set(currentProjectAtom, project);
      this.alepha.store.set(currentProjectMemberAtom, member);
      this.alepha.store.set(inboxUnreadAtom, { count: unreadEverywhere });
      this.alepha.store.set(projectPromptsAtom, prompts);

      return {
        project,
      };
    },
    onLeave: () => {
      this.alepha.store.set(currentProjectMemberAtom, undefined);
      this.alepha.store.set(currentProjectAtom, undefined);
      this.loaders.leave();
      // ⚠️ `inboxUnreadAtom` is NOT cleared here, and never was: it counts
      // every project, so zeroing it on leaving one would erase a number
      // that is still true. The project-scoped atom that was cleared here
      // went with the rail's badge (feedback #P2127).
      this.alepha.store.set(projectPromptsAtom, undefined);
    },
    errorHandler: (error) => {
      // `/:projectSlug` matches any unclaimed root path, so a typo reaches this
      // route rather than `notFound`. Without this, a signed-in user who
      // mistypes a URL gets the layout's generic ErrorPage in production
      // instead of a 404. (An anonymous one is bounced to login by `$secure()`
      // before the loader runs at all — see the note on `use` above.)
      if (HttpError.is(error, 404)) {
        return createElement(NotFound, { style: { height: "100%" } });
      }
    },
  });

  /**
   * The settings layout. Its sections declare `parent:` through
   * `$pageProjectSettings`, the way the project's pages do through
   * `$pageProject`.
   */
  projectSettings = $page({
    parent: this.project,
    path: "/settings",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Settings`,
    }),
    lazy: () => import("./components/project/settings/ProjectSettings.tsx"),
  });
}
