import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";
import { $etag } from "alepha/server/etag";

import { projects } from "../entities/projects.ts";
import { memberRoadmapResourceSchema } from "../schemas/memberRoadmapResourceSchema.ts";
import { roadmapResourceSchema } from "../schemas/roadmapResourceSchema.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { RoadmapService } from "../services/RoadmapService.ts";

/**
 * The roadmap, and **Lore's only anonymous read path**.
 *
 * ⚠️ Treat every change here as a security change, not a page change. Every
 * other action in this application carries `$secure()`, `FeedbackController`'s
 * `submitFeedback` included: even the public "report a bug" page requires
 * sign-in. `SigilIngestController` is a `$route` with its own bearer token,
 * not an exception to this. So this file is first of its kind and has no
 * neighbour to copy the reasoning from.
 *
 * Folio #1073 states the governing constraint:
 *
 * > Public pages reintroduce the anonymous read path that `projects.public`
 * > was removed to eliminate. It must be a separate, narrow, opt-in surface
 * > with its own response schema, never a relaxation of `assertMember` - the
 * > deprecated `public` column is a warning, not a template.
 *
 * **Two actions, one page.** `/:projectSlug/roadmap` is a single route; which
 * of these it calls is decided by whether the visitor has a session, and the
 * visibility gate then decides whether either answers. They compute the same
 * payload through the same service and differ in who may call - the member
 * one adds `member` on its OWN schema, never as a conditional field on the
 * shared one, because a response whose shape depends on the caller is how a
 * leak survives a green test.
 *
 * Four rules follow, and each one is load-bearing:
 *
 * 1. **A dedicated action.** Not a flag threaded through `getReleases`. The
 *    anonymous one serves `roadmapResourceSchema` and nothing else.
 * 2. **The membership gate is untouched.** Nothing here widens
 *    `assertMember`, gives it a bypass or makes it conditional. Any change to
 *    that method in this file's diff would be the wrong design.
 * 3. **404, never 403.** A 403 confirms the project exists. A caller who is
 *    not allowed to read a roadmap must not be able to tell a project with
 *    the roadmap off from a slug nobody has ever registered, so both answer
 *    the same status with the same message.
 * 4. **Resolve by slug.** An anonymous caller has no way to learn a project
 *    id, and handing one out would be the first half of a probe.
 *
 * ⚠️ **Turning a roadmap off is not instant, and that is disclosed rather
 * than fixed.** The row read below is uncached, but the RESPONSE is publicly
 * cacheable for a minute, so a visitor or a CDN can still be holding a
 * roadmap the owner has just switched off. `project.settings.roadmap.delay`
 * is the copy that says so, and the cache directives on the action are
 * pinned to it - see the note there before widening either.
 */
export class RoadmapController {
  projects = $repository(projects);
  security = $inject(ProjectSecurityService);
  roadmaps = $inject(RoadmapService);

  /**
   * The anonymous half. Answers only while `roadmapVisibility` is `public`;
   * `members` and `off` both 404 here, and a signed-in member reaches the
   * members roadmap through its own action rather than this one.
   *
   * **Public and cacheable, unlike every other action in the app.** An `etag`
   * with a real `maxAge` is correct here rather than the `noCache` the
   * viewer-mutable lists carry (`test/etag-cache-control.spec.ts` pins that
   * opposite rule): nobody reading this page can mutate it, and the data
   * changes on a human timescale. `public` lets a SHARED cache hold it, which
   * is what makes it a rate limit as well as a performance win - Lore sits
   * behind Cloudflare, so an edge hit never reaches the Worker at all. That
   * directive is only safe because this action can never return anything a
   * member sees and a stranger does not.
   *
   * ⚠️ **The window is one minute because the settings copy says one minute.**
   * `project.settings.roadmap.delay` tells the owner a change can take up to
   * a minute to reach visitors, and this is the larger half of what makes
   * that true (the other is the 30 second `$ownsProject` window the members
   * action reads through). A longer `maxAge`, an `sMaxAge` above it or a
   * `staleWhileRevalidate` would each widen the real disclosure window past
   * what the owner was told - so raising any of them means changing that
   * string in both locales first.
   */
  getPublicRoadmap = $action({
    method: "GET",
    path: "/projects/by-slug/:slug/roadmap",
    use: [
      $etag({
        control: {
          public: true,
          maxAge: [1, "minute"],
          sMaxAge: [1, "minute"],
        },
      }),
    ],
    schema: {
      params: z.object({
        slug: z.string(),
      }),
      response: roadmapResourceSchema,
    },
    handler: async ({ params }) => {
      // Soft-deleted rows are filtered out by the repository, so a deleted
      // project does not keep publishing a roadmap under its old slug.
      const project = await this.projects.findOne({
        where: { slug: { eq: params.slug } },
      });

      // ONE message for both branches, deliberately. "No such project" and
      // "that project's roadmap is not public" must be indistinguishable.
      if (!project || !(await this.security.isRoadmapVisible(project))) {
        throw new NotFoundError("Roadmap not found");
      }

      return await this.roadmaps.roadmapOf(project);
    },
  });

  /**
   * The signed-in half, and the `members` branch of the gate.
   *
   * It serves the SAME payload the public action does, computed by the same
   * service, plus `member`. The two actions differ in **who may call**, never
   * in what is computed: a response that quietly grows a field for one
   * audience is how a leak survives a green test.
   *
   * It also answers for a `public` roadmap, so a signed-in stranger reading
   * someone's public roadmap takes this path and simply gets `member: false`.
   * That is why `member` is a returned fact rather than "the member endpoint
   * answered".
   *
   * ⚠️ `noCache` rather than the public action's freshness window, and
   * `private` rather than `public`. This body can name a `members`-only
   * roadmap, so a shared cache must never hold it - and the caller is very
   * likely the person who just created or published the release they are
   * looking for, which is the exact case `test/etag-cache-control.spec.ts`
   * exists to pin. The ETag still answers 304, so revalidation stays cheap.
   */
  getMemberRoadmap = $action({
    method: "GET",
    path: "/projects/by-slug/:slug/roadmap/member",
    use: [$secure(), $etag({ control: { private: true, noCache: true } })],
    schema: {
      params: z.object({
        slug: z.string(),
      }),
      response: memberRoadmapResourceSchema,
    },
    handler: async ({ params, user }) => {
      const project = await this.projects.findOne({
        where: { slug: { eq: params.slug } },
      });

      // Same single message as the anonymous action, for the same reason: a
      // caller who may not read this roadmap must not learn whether it
      // exists. A signed-in one is no more entitled to that than a stranger.
      if (!project || !(await this.security.isRoadmapVisible(project, user))) {
        throw new NotFoundError("Roadmap not found");
      }

      return {
        ...(await this.roadmaps.roadmapOf(project)),
        // Not "the gate let me through": that is also true of a signed-in
        // stranger on a public roadmap, and the links this gates are all
        // member-only.
        member: await this.security.isMember(project.id, user),
      };
    },
  });
}
