import { $inject, z } from "alepha";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { type AppInstance, appInstances } from "../entities/appInstances.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { type Sigil, sigils } from "../entities/sigils.ts";
import {
  type AppInstanceResource,
  appInstanceResourceSchema,
} from "../schemas/appInstanceResourceSchema.ts";
import { appNameSchema } from "../schemas/appNameSchema.ts";
import { AppService } from "../services/AppService.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export type { AppInstanceResource };

/**
 * The instances of a project: every deployed copy of every app, and the
 * two-name row an operator creates by typing them.
 *
 * **Reads member-gated, mutations owner-gated**, the split `SigilController`
 * uses and the rest of the app follows. Nothing here mints a credential: a
 * sigil is an unlock added from the instance's own Settings (#1769), which is
 * the whole point of the level.
 *
 * ⚠️ The path segments are `:app` and `:env`, never `:id` or `:name`. The
 * router keeps one param node per position, so two routes naming different
 * segments the same thing collapse onto one key, the outer one wins, and the
 * inner param arrives missing. `/projects/:projectId` already owns `id` at an
 * outer position.
 *
 * ⚠️ Two segments and never a joined slug. `APP_NAME_PATTERN` allows hyphens
 * inside both halves, so `club-b14-production` is genuinely ambiguous between
 * `club` + `b14-production` and `club-b14` + `production`; both are legal rows
 * that can coexist, and a lookup by the joined string returns two and picks
 * one. The collision is silent, so it can never be the URL.
 */
export class AppController {
  protected instances = $repository(appInstances);
  protected sigils = $repository(sigils);
  protected estates = $repository(estates);
  protected security = $inject(ProjectSecurityService);
  protected service = $inject(AppService);
  protected audits = $inject(LoreAudits);

  /**
   * Every instance in the project, plus the distinct app names.
   *
   * The names ride along rather than getting an endpoint of their own: the
   * create dialog's combobox (#1772) and MCP (#1778) both want exactly the
   * `GROUP BY app` of the rows already being returned, and a second request
   * for a projection of the first one is a request that can disagree with it.
   *
   * Member-gated, like `listSigils` before it: the list is an inventory of
   * what this project runs, which is what the sidebar, the blights filter and
   * the insights page all mean, and none of those is owner-only.
   */
  listApps = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/apps",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({
        items: z.array(appInstanceResourceSchema),
        apps: z.array(z.string()),
      }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);

      const rows = await this.instances.findMany({
        where: { projectId: { eq: params.projectId } },
        orderBy: [
          { column: "app", direction: "asc" },
          { column: "env", direction: "asc" },
        ],
      });

      const items = await this.toResources(rows);
      return {
        items,
        // Sorted because the rows are: the combobox offers them in the order
        // the table reads in.
        apps: [...new Set(rows.map((row) => row.app))],
      };
    },
  });

  /**
   * One instance by its pair.
   *
   * The `projectId` filter inside {@link AppService.load} is the cross-project
   * guard: without it a pair from another project would resolve and the
   * membership check would have passed on the wrong project.
   */
  getApp = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/apps/:app/:env",
    schema: {
      params: z.object({
        projectId: z.integer(),
        app: appNameSchema,
        env: appNameSchema,
      }),
      response: appInstanceResourceSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);
      const instance = await this.service.load(
        params.projectId,
        params.app,
        params.env,
      );
      return this.toResource(instance);
    },
  });

  /**
   * Create an instance by typing two names. Mints nothing.
   *
   * Audited like a sigil create, because the row IS the deploy target: epic
   * #1's deploy resolves an estate from it, so who created it is a question
   * somebody comes back to.
   */
  createApp = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "POST",
    path: "/projects/:projectId/apps",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        /**
         * The app, e.g. `club`. Trimmed and lowercased before it is validated,
         * so `Club` is accepted and stored as `club` rather than refused.
         */
        app: appNameSchema,
        /**
         * Which copy, e.g. `production`. Free text within the same charset;
         * nothing parses it, and nothing may start.
         */
        env: appNameSchema,
        /**
         * Where this copy lives, if the operator already knows. Optional: the
         * address is normally the host the app reports from.
         */
        url: z.string().max(2048).optional(),
      }),
      response: appInstanceResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.projectId, user);

      const instance = await this.service.create({
        projectId: params.projectId,
        app: body.app,
        env: body.env,
        ...(body.url === undefined ? {} : { url: body.url }),
        createdBy: user.id,
      });

      await this.audits.app.logSuccess("create", {
        ...this.audits.actor(user),
        ...this.audits.scope(params.projectId),
        resourceType: "app",
        resourceId: instance.id,
        description: `${instance.app}/${instance.env}`,
      });

      return this.toResource(instance);
    },
  });

  /**
   * Rename either half, pin the address, or point it at an estate.
   *
   * Every key optional and an absent one meaning "leave it alone", the shape
   * `updateSigil` has and every settings row in this app relies on: the name
   * fields, the URL field and the estate select are separate surfaces, and
   * each PATCHes only what it owns.
   *
   * `url` follows the empty-string-clears rule, because it is an override
   * whose absence is meaningful; the two names have no such reading, since an
   * instance without them has no URL segment. `estateId` is `uuid | null` and
   * goes through {@link AppService.setEstate}, which validates it against the
   * lending join rather than against `estates`.
   *
   * ⚠️ The rename and the estate are two service calls in one handler and are
   * not wrapped in a transaction. A caller that sends both and half-fails
   * leaves a renamed instance pointing at the old estate, which is a state a
   * second PATCH fixes; the alternative is a transaction around a method that
   * writes two tables, and the mirror write inside it is the thing that must
   * not be split from its rename - which is why THAT pair lives in one method.
   */
  updateApp = $action({
    use: [$secure({ permissions: ["project:update"] })],
    method: "PATCH",
    path: "/projects/:projectId/apps/:app/:env",
    schema: {
      params: z.object({
        projectId: z.integer(),
        app: appNameSchema,
        env: appNameSchema,
      }),
      body: z.object({
        app: appNameSchema.optional(),
        env: appNameSchema.optional(),
        /**
         * The empty string clears the pin and hands the address back to the
         * host the app reports from.
         */
        url: z.string().max(2048).optional(),
        /**
         * `null` clears the deploy target. Validated against
         * `estate_projects`: a project cannot point at an estate it was never
         * lent, and the refusal is a 404 so it cannot learn one exists.
         */
        estateId: z.uuid().nullable().optional(),
      }),
      response: appInstanceResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.projectId, user);
      let instance = await this.service.load(
        params.projectId,
        params.app,
        params.env,
      );

      if (body.app !== undefined || body.env !== undefined) {
        instance = await this.service.rename(instance, {
          ...(body.app === undefined ? {} : { app: body.app }),
          ...(body.env === undefined ? {} : { env: body.env }),
        });
      }
      if (body.url !== undefined) {
        instance = await this.service.setUrl(instance, body.url);
      }
      if (body.estateId !== undefined) {
        instance = await this.service.setEstate(instance, body.estateId);
      }

      await this.audits.app.logSuccess("update", {
        ...this.audits.actor(user),
        ...this.audits.scope(params.projectId),
        resourceType: "app",
        resourceId: instance.id,
        description: `${instance.app}/${instance.env}`,
      });

      return this.toResource(instance);
    },
  });

  /**
   * Remove an instance, and the sigil it holds.
   *
   * A warning, like deleting a sigil, and for the same reason: the four
   * aggregate tables cascade on `sigilId`, so this takes that copy's views,
   * uniques, vitals and error groups with it. Blights survive
   * (`blights.sigilId` is `ON DELETE SET NULL`): a triage decision outlives
   * the credential that surfaced it.
   *
   * ⚠️ **Deleting an instance undeploys nothing.** It removes Lore's record of
   * a deployed copy, not the copy. Refusing is not this endpoint's job either
   * - the confirmation dialog is the UI's.
   */
  deleteApp = $action({
    use: [$secure({ permissions: ["project:delete"] })],
    method: "DELETE",
    path: "/projects/:projectId/apps/:app/:env",
    schema: {
      params: z.object({
        projectId: z.integer(),
        app: appNameSchema,
        env: appNameSchema,
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.assertOwner(params.projectId, user);
      const instance = await this.service.load(
        params.projectId,
        params.app,
        params.env,
      );

      await this.service.delete(instance);

      await this.audits.app.logSuccess("delete", {
        ...this.audits.actor(user),
        ...this.audits.scope(params.projectId),
        severity: "warning",
        resourceType: "app",
        resourceId: instance.id,
        description: `${instance.app}/${instance.env}`,
      });

      return { ok: true };
    },
  });

  /**
   * A batch of rows with their unlocks, in two queries rather than two per
   * row.
   *
   * `inArray` over the ids this project's own rows carry, so the list is
   * bounded by the project's instance count. ⚠️ If that ever approaches D1's
   * 100-parameter ceiling (folio #1173), chunk at 90 like `BlightJobs.chunked`
   * rather than raising it.
   */
  protected async toResources(
    rows: AppInstance[],
  ): Promise<AppInstanceResource[]> {
    if (rows.length === 0) {
      return [];
    }

    const sigilIds = [
      ...new Set(rows.flatMap((row) => (row.sigilId ? [row.sigilId] : []))),
    ];
    const estateIds = [
      ...new Set(rows.flatMap((row) => (row.estateId ? [row.estateId] : []))),
    ];

    const [sigilRows, estateRows] = await Promise.all([
      sigilIds.length
        ? this.sigils.findMany({ where: { id: { inArray: sigilIds } } })
        : Promise.resolve([]),
      estateIds.length
        ? this.estates.findMany({ where: { id: { inArray: estateIds } } })
        : Promise.resolve([]),
    ]);

    const bySigil = new Map(sigilRows.map((row) => [row.id, row]));
    const byEstate = new Map(estateRows.map((row) => [row.id, row]));

    return rows.map((row) =>
      this.project(
        row,
        row.sigilId ? bySigil.get(row.sigilId) : undefined,
        row.estateId ? byEstate.get(row.estateId) : undefined,
      ),
    );
  }

  protected async toResource(
    instance: AppInstance,
  ): Promise<AppInstanceResource> {
    const [resource] = await this.toResources([instance]);
    return resource;
  }

  /**
   * The row plus its unlocks, with nothing else crossing.
   *
   * The two nested shapes are built field by field rather than spread: a
   * spread of the sigil row would carry `tokenHash` into a browser the day
   * somebody widens the query above.
   */
  protected project(
    instance: AppInstance,
    sigil?: Sigil,
    estate?: Estate,
  ): AppInstanceResource {
    return {
      id: instance.id,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      projectId: instance.projectId,
      app: instance.app,
      env: instance.env,
      url: instance.url,
      sigilId: instance.sigilId,
      estateId: instance.estateId,
      ...(sigil
        ? {
            sigil: {
              id: sigil.id,
              tokenPrefix: sigil.tokenPrefix,
              kinds: sigil.kinds ?? [],
              createdAt: sigil.createdAt,
              lastSeenAt: sigil.lastSeenAt,
              lastSeenHost: sigil.lastSeenHost,
              reportedConfig: sigil.reportedConfig,
              reportedConfigAt: sigil.reportedConfigAt,
            },
          }
        : {}),
      ...(estate
        ? {
            estate: {
              id: estate.id,
              slug: estate.slug,
              type: estate.type,
              label: estate.label,
            },
          }
        : {}),
    };
  }
}
