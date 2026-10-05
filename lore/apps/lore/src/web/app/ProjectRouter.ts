import { inboxUnreadAtom } from "@alepha/ui/shell";
import { $inject, Alepha, z } from "alepha";
import type { NotificationInboxController } from "alepha/api/notifications";
import { $page, NotFound } from "alepha/react/router";
import { $secure } from "alepha/security";
import { HttpError } from "alepha/server";
import { $client } from "alepha/server/links";
import { createElement } from "react";

import type { AppController } from "../../api/controllers/AppController.ts";
import type { AreaController } from "../../api/controllers/AreaController.ts";
import type { BlightController } from "../../api/controllers/BlightController.ts";
import type { EpicController } from "../../api/controllers/EpicController.ts";
import type { FeedbackController } from "../../api/controllers/FeedbackController.ts";
import type { ProjectController } from "../../api/controllers/ProjectController.ts";
import type { ProjectPromptController } from "../../api/controllers/ProjectPromptController.ts";
import type { QuestController } from "../../api/controllers/QuestController.ts";
import type { ReleaseController } from "../../api/controllers/ReleaseController.ts";
import { currentAreasAtom } from "./atoms/currentAreasAtom.ts";
import { currentAssignedQuestsAtom } from "./atoms/currentAssignedQuestsAtom.ts";
import { currentBlightCountAtom } from "./atoms/currentBlightCountAtom.ts";
import { currentEpicCountAtom } from "./atoms/currentEpicCountAtom.ts";
import { currentEpicsAtom } from "./atoms/currentEpicsAtom.ts";
import { currentFeedbackCountAtom } from "./atoms/currentFeedbackCountAtom.ts";
import { currentInstancesAtom } from "./atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "./atoms/currentProjectMemberAtom.ts";
import { currentQuestCountAtom } from "./atoms/currentQuestCountAtom.ts";
import { currentReleasesAtom } from "./atoms/currentReleasesAtom.ts";
import { projectPromptsAtom } from "./atoms/projectPromptsAtom.ts";
import {
  capabilityOption,
  hasCapability,
} from "./services/projectCapabilities.ts";

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
  protected readonly questApi = $client<QuestController>();
  protected readonly projectApi = $client<ProjectController>();
  protected readonly feedbackApi = $client<FeedbackController>();
  protected readonly epicApi = $client<EpicController>();
  protected readonly areaApi = $client<AreaController>();
  protected readonly blightApi = $client<BlightController>();
  protected readonly inboxApi = $client<NotificationInboxController>();
  protected readonly releaseApi = $client<ReleaseController>();
  protected readonly appApi = $client<AppController>();
  protected readonly promptApi = $client<ProjectPromptController>();

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
      // never share a window because each blocks on a full round trip. As a
      // chain these were six requests deep on every project navigation; as
      // one `Promise.all` they are a single batched request, which is also
      // why adding the epic count below costs nothing.
      //
      // Rejection behaviour is unchanged: `getReleases` still has no
      // `.catch`, so a failure there rejects the loader exactly as it did
      // when it was awaited first.
      const [
        quests,
        releases,
        pendingFeedback,
        openQuests,
        epicRefs,
        instances,
        openBlights,
        areas,
        unreadEverywhere,
        prompts,
      ] = await Promise.all([
        // The viewer's open quests, which rode on the project response until
        // core stopped reading Work's tables (#E75, #Q2623). Same round, so
        // the batch still coalesces it; `[]` on failure, like the counts,
        // rather than taking the project down.
        this.questApi
          .getMyActiveQuests({ params: { projectId: project.id } })
          .catch(() => []),
        this.releaseApi.getReleases({
          params: { projectId: project.id },
        }),

        // Pending-feedback count for the sidebar badge. Fetched once per
        // project navigation instead of polled: accept/reject/remove
        // actions adjust the atom locally, so within-session math stays
        // correct. Errors count as 0 (the badge hides).
        //
        // `countFeedback`, not `listFeedback().items.length`: the list pages
        // at ten now, so counting it would cap the badge at 10 over an inbox
        // of 106 (#1744).
        this.feedbackApi
          .countFeedback({
            params: { projectId: project.id },
            query: { status: "pending" },
          })
          .then((r) => r.count)
          .catch(() => 0),

        // Open-quest count for the sidebar badge. Always on (unlike Blights /
        // Feedback, Quests has no feature gate) and member-readable; `.catch`
        // keeps a transient error from blocking the whole project load
        // (badge just hides).
        this.questApi
          .countOpenQuests({ params: { projectId: project.id } })
          .then((r) => r.count)
          .catch(() => 0),

        // Every epic as a ref, which serves two readers at once: the sidebar's
        // draft-epic badge, counted locally below, and the quests table's
        // Epic column, which resolves `quests.epicId` against it exactly as
        // the Release column resolves `releaseId` against `currentReleasesAtom`.
        //
        // It replaced a `countPlannedEpics` call rather than joining it, so
        // this stays one request. `getEpicRefs` and not `getEpics`: the full
        // resource carries `description`, which is 213 KB of the 222 KB this
        // project's own epic list weighs, and no reader here wants a word of it.
        //
        // Gated on the same `work.epics` option that decides whether the
        // Epics entry renders at all, so a project with epics off pays nothing.
        //
        // The badge is the counterweight to the quest count above: that one
        // runs the backlog gate, so quests parked inside a draft epic are
        // excluded from it on purpose. Without this number the sidebar
        // reported none of that work.
        //
        // `undefined` on failure and NOT `[]`, like `currentInstancesAtom`: the
        // badge must read "could not count" rather than "no drafts".
        capabilityOption(project, "work", "epics")
          ? this.epicApi
              .getEpicRefs({ params: { projectId: project.id } })
              .catch(() => undefined)
          : Promise.resolve([]),

        // The project's app instances. Member-readable (`listApps` is gated
        // on `project:read`, unlike every mutation, which is owner-only)
        // but `.catch` keeps a transient failure from taking the whole
        // project down with it: a degraded section costs a section, an
        // unhandled rejection costs the page.
        //
        // `undefined` on failure, NOT `[]`: the sidebar entry, Spotlight and
        // the Blights derivation below all need to tell "no apps" apart from
        // "could not read the apps": see `currentInstancesAtom`.
        hasCapability(project, "apps")
          ? this.appApi
              .listApps({ params: { projectId: project.id } })
              .then((r) => r.items)
              .catch(() => undefined)
          : Promise.resolve([]),

        // Open-blight count for the sidebar badge. Member-readable; `.catch`
        // keeps a transient error from blocking the whole project load
        // (badge just hides).
        //
        // Counted under the module's master switch alone, deliberately *not*
        // narrowed to "some enrolled app still carries the `blights` kind". A
        // blight outlives the credential that filed it: `blights.sigilId` is
        // `ON DELETE SET NULL` and rows survive for `retentionDays`, so an
        // owner who deletes their last app, or just switches Blights off on it,
        // still has an inbox full of open crashes. Deriving the count from the
        // apps would zero it in the same instant the sidebar entry vanished,
        // and `ProjectView` reads this count to keep that entry reachable.
        hasCapability(project, "apps")
          ? this.blightApi
              .countOpenBlights({ params: { projectId: project.id } })
              .then((r) => r.count)
              .catch(() => 0)
          : Promise.resolve(0),

        // The one list every area picker reads. Member-readable, and
        // `.catch` keeps a transient failure from taking the page down:
        // an empty picker costs a picker, an unhandled rejection costs the
        // project.
        this.areaApi
          .getAreas({ params: { projectId: project.id } })
          .catch(() => undefined),

        // ⚠️ ONE inbox count, and it is deliberately the cross-project one.
        // Alepha and Odzala are open in the same session and a ping in one
        // must not be invisible from the other, so this passes NO scope. It
        // seeds `inboxUnreadAtom` before the first paint, which is what the
        // bell's own mount-fetch then does not have to do.
        //
        // A second, `scope: project:<id>` call sat here for the rail's own
        // badge until the rail entry was removed (feedback #P2127). It was
        // one request per project navigation for a number nothing reads.
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
        // ⚠️ `{}` on failure and NOT `undefined`, unlike every neighbour
        // above. They distinguish "could not read" from "none" because a
        // badge must not say zero when it means unknown; here there is
        // nothing to distinguish. The built-in defaults are a complete
        // answer, so a failed read is indistinguishable from a project that
        // has customised nothing, and the menus keep working either way.
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
      this.alepha.store.set(currentAssignedQuestsAtom, quests);
      this.alepha.store.set(currentReleasesAtom, releases);
      this.alepha.store.set(currentFeedbackCountAtom, {
        count: pendingFeedback,
      });
      this.alepha.store.set(currentBlightCountAtom, { count: openBlights });
      this.alepha.store.set(currentQuestCountAtom, { count: openQuests });
      this.alepha.store.set(currentEpicsAtom, epicRefs);
      // Counted here rather than server-side, the same way `ProjectEpics`
      // counts it off the list it already holds. `undefined` means the read
      // failed, and 0 is the honest answer for a badge that can only hide.
      this.alepha.store.set(currentEpicCountAtom, {
        count: (epicRefs ?? []).filter((epic) => epic.status === "draft")
          .length,
      });
      this.alepha.store.set(currentInstancesAtom, instances);
      this.alepha.store.set(currentAreasAtom, areas);
      this.alepha.store.set(inboxUnreadAtom, { count: unreadEverywhere });
      this.alepha.store.set(projectPromptsAtom, prompts);

      return {
        project,
      };
    },
    onLeave: () => {
      this.alepha.store.set(currentProjectMemberAtom, undefined);
      this.alepha.store.set(currentProjectAtom, undefined);
      this.alepha.store.set(currentAssignedQuestsAtom, []);
      this.alepha.store.set(currentReleasesAtom, undefined);
      this.alepha.store.set(currentFeedbackCountAtom, { count: 0 });
      this.alepha.store.set(currentBlightCountAtom, { count: 0 });
      this.alepha.store.set(currentQuestCountAtom, { count: 0 });
      this.alepha.store.set(currentEpicCountAtom, { count: 0 });
      this.alepha.store.set(currentEpicsAtom, undefined);
      this.alepha.store.set(currentInstancesAtom, undefined);
      this.alepha.store.set(currentAreasAtom, undefined);
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
