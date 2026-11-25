import { inboxUnreadAtom } from "@alepha/ui/shell";
import {
  $inject,
  Alepha,
  createMiddleware,
  MIDDLEWARE_PROTECTED,
  z,
} from "alepha";
import type { NotificationInboxController } from "alepha/api/notifications";
import { $page } from "alepha/react/router";
import { isHttpError, NotFoundError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { ProjectController } from "../../api/controllers/ProjectController.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "./atoms/currentProjectMemberAtom.ts";
import { userProjectsAtom } from "./atoms/userProjectsAtom.ts";
import NotFoundPage from "./components/shared/NotFoundPage.tsx";
import {
  ProjectLoaderRegistry,
  type ProjectLoaderSubject,
} from "./registries/ProjectLoaderRegistry.ts";

/**
 * The project layout's guard. Every visitor reaches the loader, which is
 * where the member check happens (see `ProjectRouter.resolve`); this marks
 * the layer protected so the router keeps its subtree client-rendered, as
 * `$secure()` would otherwise, without sending a stranger to sign-in.
 */
const projectAccess = () =>
  createMiddleware({
    name: "projectAccess",
    meta: { [MIDDLEWARE_PROTECTED]: "true" },
    handler: ({ next }) => next,
  });

/**
 * The two layouts every project page hangs under: `/:projectSlug` and its
 * `/settings`.
 *
 * They hold no `children` list. A page joins them by declaring `parent:`,
 * through `$pageProject` and `$pageProjectSettings`, so the layout never names
 * a page of another module (#E75, #Q2609): the `@lore` packages each declare
 * their own pages, and this class becomes `@lore/core/web`'s.
 *
 * ⚠️ Its own class, apart from `CoreRouter`, for the cycle: `$pageProject`
 * injects this class, and a page of `CoreRouter` calling it while `CoreRouter`
 * is still being constructed would inject `CoreRouter` into itself.
 */
export class ProjectRouter {
  protected readonly alepha = $inject(Alepha);
  protected readonly projectApi = $client<ProjectController>();
  protected readonly inboxApi = $client<NotificationInboxController>();
  protected readonly loaders = $inject(ProjectLoaderRegistry);

  project = $page({
    /**
     * A **root-level** param: `/demo/quests/19`, not `/p/2/q/19`.
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
    // renders for a non-member. The gate is the loader, not `$secure()`: it
    // resolves the project FIRST and answers a non-member, signed in or not,
    // with the same 404 as an unknown slug. `$secure()` here would send an
    // anonymous visitor to sign-in before that, which tells them the slug is
    // real.
    //
    // `projectAccess` is that gate's marker: a guard that lets every visitor
    // through to the loader, flagged protected so the subtree stays in CSR
    // (the mode follows the access model, `test/app-ssr-mode.spec.ts`).
    use: [projectAccess()],
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
    viewTransition: ({ meta }) =>
      meta.firstOpen ? { enter: "project-open" } : undefined,
    lazy: () => import("./components/project/ProjectView.tsx"),
    loader: async ({ params }) => {
      // The one slug→id resolution in the app. Every fetch below, and every
      // endpoint any page under this layout calls, still takes the integer
      // id, read off `currentProjectAtom`. That is what keeps slug routing out
      // of the rest of the API surface.
      const resolving = this.resolve(params.projectSlug);

      // The shell's reads need the project's id and capabilities, and the
      // rail's row holds both: started here, in the tick the slug read left
      // in, they ride its `POST /api/_batch` instead of waiting a round trip
      // for its answer (#Q3824). `/api/_batch` runs its entries together, so
      // the pair costs the slower of the two.
      //
      // ⚠️ The answer stays the authority. Nothing is written before it, a
      // refusal is the only error this loader reports, and reads started
      // from a row that disagrees with it are thrown away and run again.
      const known = this.known(params.projectSlug);
      const early = known ? this.shell(known) : undefined;
      // Awaited only once the slug has answered: a refused slug must not
      // leave this one's rejection unhandled.
      early?.catch(() => undefined);

      // `quests` is the narrow list kept on the response for published CLIs;
      // the full resources come from Work below.
      const { member, quests: _assignedWork, ...project } = await resolving;

      const [applyModules, unreadEverywhere] = await (early &&
      known &&
      this.loaders.same(known, project)
        ? early
        : this.shell(project));

      applyModules();
      this.alepha.store.set(currentProjectAtom, project);
      this.alepha.store.set(currentProjectMemberAtom, member);
      this.alepha.store.set(inboxUnreadAtom, { count: unreadEverywhere });

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
    },
    errorHandler: (error) => {
      // `/:projectSlug` matches any unclaimed root path, so a typo reaches this
      // route rather than `notFound`. Without this, a visitor who mistypes a
      // URL gets the layout's generic ErrorPage in production instead of a
      // 404, signed in or not.
      if (isHttpError(error, 404)) {
        return createElement(NotFoundPage);
      }
    },
  });

  /**
   * The project at `slug` as the rail holds it, when it does:
   * `userProjectsAtom` lists every project the viewer belongs to.
   *
   * A hint, never an answer. The row may be stale (a capability switched in
   * another tab, a slug renamed and taken by another project), which is why
   * the loader compares it with what `getProjectBySlug` says before keeping
   * anything read from it.
   */
  protected known(slug: string): ProjectLoaderSubject | undefined {
    return this.alepha.store
      .get(userProjectsAtom)
      ?.projects.find((it) => it.slug === slug);
  }

  /**
   * Everything the shell reads for a project besides the project itself,
   * issued together: the browser's `BatchCollector` coalesces action calls
   * raised within a 10ms window into ONE `POST /api/_batch`, and sequential
   * awaits can never share a window because each blocks on a full round
   * trip.
   *
   * Each module's part of it is a registered contribution
   * (`ProjectLoaderRegistry`, #E75 #Q2624): this loader is core and names no
   * module's client. It answers their writes instead of making them, with
   * the inbox count, so the caller decides whether this
   * project is the one to write.
   */
  protected shell(project: ProjectLoaderSubject) {
    return Promise.all([
      this.loaders.fetch(project),

      // ⚠️ ONE inbox count, and it is deliberately the cross-project one.
      // Two projects are open in the same session and a ping in one
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
    ]);
  }

  /**
   * The slug as the caller may see it.
   *
   * A member gets the project. Anyone else, signed in or not, gets the same
   * 404 as an unknown slug, so the answer never tells a project they are not
   * a member of from a missing one. Nothing behind the link loads: the
   * layout fails before any child loader runs.
   */
  protected async resolve(slug: string) {
    try {
      return await this.projectApi.getProjectBySlug({ params: { slug } });
    } catch (error) {
      if (
        !isHttpError(error, 401) &&
        !isHttpError(error, 403) &&
        !isHttpError(error, 404)
      ) {
        throw error;
      }
      throw new NotFoundError("Project not found");
    }
  }

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
