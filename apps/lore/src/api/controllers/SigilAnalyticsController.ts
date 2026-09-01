import { $inject, z } from "alepha";
import {
  adminAnalyticsQuerySchema,
  adminAnalyticsResultSchema,
  AdminAnalyticsService,
  adminDatasetSchema,
} from "alepha/api/analytics";
import { $repository } from "alepha/orm";
import { $secure, type UserAccountToken } from "alepha/security";
import { $action, NotFoundError } from "alepha/server";

import { type Sigil, sigils } from "../entities/sigils.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * The per-app query explorer: the framework's analytics query builder, narrowed
 * to one enrolled app.
 *
 * This is the same surface as `/api/admin/analytics/*` and the same query
 * language, served to project members instead of to instance admins. All of
 * the narrowing is `AdminAnalyticsService`'s `pin`, so there is no second
 * implementation of the query language here to drift out of step with the
 * first — this controller contributes exactly one thing, and it is the part
 * the framework cannot know: whether this caller may read this app.
 *
 * **The scope is not a filter the UI applies.** The pin removes `sigilId` from
 * the published descriptors, so the panel never offers it, and it refuses a
 * body that names it rather than overwriting one. A hidden control would be
 * decoration: anyone can post the body themselves.
 *
 * Reads are **member**-gated, unlike every sigil mutation, which is owner-only.
 * These are the same two datasets `InsightsController` already exposes to
 * members as leaderboards — the same data, sliced by the reader instead of by
 * us — and the tab is linked from a nav every member sees.
 */
export class SigilAnalyticsController {
  protected readonly url = "/projects/:projectId/sigils/:sigilId/analytics";
  protected readonly group = "sigil:analytics";

  protected sigils = $repository(sigils);
  protected security = $inject(ProjectSecurityService);
  protected service = $inject(AdminAnalyticsService);

  /**
   * The datasets this app has, as the explorer's descriptors.
   *
   * Only the datasets that declare `sigilId` come back, because only those can
   * be narrowed to one app. That list is derived from the declarations rather
   * than written down here, so a third sigil dataset appears with no change to
   * this file, and a dataset without the dimension can never appear at all.
   */
  listAppDatasets = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: `${this.url}/datasets`,
    group: this.group,
    description: "List the analytics datasets readable for one app",
    schema: {
      params: z.object({ projectId: z.integer(), sigilId: z.uuid() }),
      response: z.array(adminDatasetSchema),
    },
    handler: async ({ params, user }) => {
      await this.assertApp(params.projectId, params.sigilId, user);
      return this.service.listDatasets({ pin: { sigilId: params.sigilId } });
    },
  });

  /**
   * One aggregate query, against one dataset, scoped to this app.
   */
  queryAppDataset = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "POST",
    path: `${this.url}/datasets/:name/query`,
    group: this.group,
    description: "Run an aggregate query against one dataset, scoped to an app",
    schema: {
      params: z.object({
        projectId: z.integer(),
        sigilId: z.uuid(),
        name: z.text(),
      }),
      body: adminAnalyticsQuerySchema,
      response: adminAnalyticsResultSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.assertApp(params.projectId, params.sigilId, user);
      return this.service.queryDataset(params.name, body, {
        pin: { sigilId: params.sigilId },
      });
    },
  });

  /**
   * Proves the caller may read this app, and returns it.
   *
   * Two checks, and the second is the one that is easy to forget. Membership
   * is on the PROJECT, so a sigil id arriving from the client has to be proved
   * to belong to that project before it narrows anything — otherwise this
   * reads another project's traffic through a project the caller is a
   * legitimate member of. `InsightsController` states the same rule for its
   * `?sigilId=`, and the proof is the same shape: the lookup carries
   * `projectId`, so a stranger's id simply does not resolve.
   *
   * A stranger's id is a 404 rather than a 403, and so is an app with Beacon
   * off. Both are "no such app here", which is the true answer: the tab is
   * hidden on exactly these conditions, and a 403 would confirm the existence
   * of an app in a project the caller cannot see.
   */
  protected async assertApp(
    projectId: number,
    sigilId: string,
    user: UserAccountToken,
  ): Promise<Sigil> {
    await this.security.assertMember(projectId, user);

    const sigil = await this.sigils.findOne({
      where: { id: { eq: sigilId }, projectId: { eq: projectId } },
    });
    if (!sigil) {
      throw new NotFoundError("App not found");
    }
    if (!sigil.kinds.includes("beacon")) {
      throw new NotFoundError("Beacon is not enabled for this app");
    }
    return sigil;
  }
}
