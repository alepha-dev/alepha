import { $inject, z } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { type AppInstance, appInstances } from "../entities/appInstances.ts";
import { deployments } from "../entities/deployments.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { type Sigil, sigils } from "../entities/sigils.ts";
import {
  type AppInstanceResource,
  appInstanceResourceSchema,
} from "../schemas/appInstanceResourceSchema.ts";
import { appNameSchema } from "../schemas/appNameSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { AppService } from "../services/AppService.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";
import { TeardownService } from "../services/TeardownService.ts";

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
  protected deployments = $repository(deployments);
  protected security = $inject(ProjectSecurityService);
  protected service = $inject(AppService);
  protected readonly teardown = $inject(TeardownService);
  protected readonly log = $logger();
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
    use: [$ownsProject({ requires: "app:read", param: "projectId" })],
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
    use: [$ownsProject({ requires: "app:read", param: "projectId" })],
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
    use: [
      $ownsProject({
        requires: "app:manage",
        param: "projectId",
        capability: { key: "apps", action: "create an app instance" },
      }),
    ],
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
        /**
         * Mint this copy's sigil and put its key straight into the copy's
         * environment, so a deploy that follows reports without anybody
         * pasting a credential.
         *
         * ⚠️ Only meaningful HERE. `sigils` keeps a hash, so the key can be
         * stored at the moment it is minted and never afterwards.
         */
        sigil: z.boolean().optional(),
        /**
         * This copy's data may be deleted with it.
         *
         * ⚠️ **Settable here and nowhere else.** `updateApp` has no such field
         * and must never grow one: a flag that could be flipped later would be
         * flipped on the copy somebody wants to tidy away, which is exactly
         * the copy whose database matters. Declared at creation it is a claim
         * about a copy that holds nothing yet.
         */
        ephemeral: z.boolean().optional(),
      }),
      response: appInstanceResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const instance = await this.service.create({
        projectId: params.projectId,
        app: body.app,
        env: body.env,
        ...(body.url === undefined ? {} : { url: body.url }),
        ...(body.ephemeral === undefined ? {} : { ephemeral: body.ephemeral }),
        createdBy: user.id,
      });

      if (body.sigil) {
        await this.service.provisionSigil(instance, { createdBy: user.id });
      }

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
    use: [
      $ownsProject({
        requires: "app:manage",
        param: "projectId",
        capability: { key: "apps", action: "update an app instance" },
      }),
    ],
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
  /**
   * Give an existing copy a sigil and store its key, idempotently.
   *
   * The same operation `createApp`'s `sigil` flag runs, reachable for a copy
   * that already exists - which is what `lore apps deploy --sigil` needs,
   * since that command deliberately never creates a copy.
   *
   * ⚠️ Answers `minted: false` for a copy already carrying its key rather than
   * refusing, so a `--sigil` left in a CI command does not fail every run
   * after the first. A copy whose sigil exists with no stored key IS refused:
   * see `AppService.provisionSigil` for why that one cannot be repaired.
   */
  ensureAppSigil = $action({
    use: [
      $ownsProject({
        requires: "sigil:manage",
        param: "projectId",
        capability: { key: "apps", action: "mint a sigil" },
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/apps/:app/:env/sigil",
    schema: {
      params: z.object({
        projectId: z.integer(),
        app: appNameSchema,
        env: appNameSchema,
      }),
      response: z.object({ minted: z.boolean() }),
    },
    handler: async ({ params, user }) => {
      const instance = await this.service.load(
        params.projectId,
        params.app,
        params.env,
      );

      const result = await this.service.provisionSigil(instance, {
        createdBy: user.id,
      });

      if (result.minted) {
        // A sigil is a credential, so its whole life is audited and kept
        // longer than the rest.
        await this.audits.sigil.logSuccess("create", {
          ...this.audits.actor(user),
          ...this.audits.scope(params.projectId),
          resourceType: "sigil",
          resourceId: instance.id,
          description: `${instance.app}/${instance.env}`,
        });
      }

      return result;
    },
  });

  /**
   * Remove what this copy's deploys created in the estate.
   *
   * ⚠️ **Its own verb, and never a side effect.** Deleting the copy, deleting
   * the project and withdrawing the estate all leave the cloud resources
   * alone: destroying somebody's database is not something to infer from a
   * tidy-up. This is the one action that does it, and it says so.
   *
   * ⚠️ The confirmation is the copy's own `app/env`, typed. A checkbox is a
   * reflex; typing the name is the only confirmation that requires reading
   * which copy is about to lose its database.
   */
  destroyAppResources = $action({
    use: [
      $ownsProject({
        requires: "app:manage",
        param: "projectId",
        capability: { key: "apps", action: "destroy an app's resources" },
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/apps/:app/:env/destroy",
    description:
      "Delete the Worker, queue and cache this copy uses. Its database and bucket are kept.",
    schema: {
      params: z.object({
        projectId: z.integer(),
        app: appNameSchema,
        env: appNameSchema,
      }),
      body: z.object({
        /**
         * The copy's `app/env`, typed by whoever is asking.
         */
        confirm: z.string().min(1).max(200),
      }),
      response: z.object({
        removed: z.array(z.string()),
        /**
         * What was deliberately left standing, named so an operator reads that
         * their data is still there rather than assuming either way.
         */
        kept: z.array(z.string()),
        failed: z.array(
          z.object({ resource: z.string(), message: z.string() }),
        ),
      }),
    },
    handler: async ({ params, body, user }) => {
      const instance = await this.service.load(
        params.projectId,
        params.app,
        params.env,
      );

      const expected = `${instance.app}/${instance.env}`;
      if (body.confirm.trim() !== expected) {
        throw new BadRequestError(
          `Type "${expected}" to confirm. This deletes the Worker, the queue and the cache namespace; the database and the bucket are KEPT.`,
        );
      }

      const result = await this.teardown.destroy(instance);

      // ⚠️ Nothing after the destruction may fail the request. The resources
      // are already gone by this line, so an error here does not undo them -
      // it reports "500" for work that succeeded, which is how an operator
      // retries a destroy that already ran and how a partial teardown becomes
      // invisible. This exact call shipped naming an action the audit did not
      // declare, and the 500 it raised hid a Worker and a database that had
      // just been deleted.
      try {
        await this.audits.app.logSuccess("destroy", {
          ...this.audits.actor(user),
          ...this.audits.scope(params.projectId),
          severity: "warning",
          resourceType: "app",
          resourceId: instance.id,
          description: `${expected}: removed ${result.removed.join(", ") || "nothing"}, kept ${result.kept.join(", ") || "nothing"}`,
        });
      } catch (error) {
        this.log.error("Could not audit a destroy that already happened", {
          instanceId: instance.id,
          removed: result.removed,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return result;
    },
  });

  deleteApp = $action({
    use: [
      $ownsProject({
        requires: "app:manage",
        param: "projectId",
        capability: { key: "apps", action: "delete an app instance" },
      }),
    ],
    method: "DELETE",
    path: "/projects/:projectId/apps/:app/:env",
    schema: {
      params: z.object({
        projectId: z.integer(),
        app: appNameSchema,
        env: appNameSchema,
      }),
      body: z
        .object({
          /**
           * Delete the copy even though Lore still records resources for it.
           *
           * ⚠️ They are not tidied up - they are forgotten, and no screen will
           * name them again. For a copy whose resources were removed by hand.
           */
          forget: z.boolean().optional(),
        })
        .optional(),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      const instance = await this.service.load(
        params.projectId,
        params.app,
        params.env,
      );

      // ⚠️ Refused while the estate still holds what this copy's deploys made.
      // The record lives on this row, so deleting it does not orphan the
      // resources - it makes them UNREACHABLE, with nothing left anywhere that
      // knows their names. `forget` is for a copy whose resources somebody
      // removed by hand, which is a real state and not one Lore can detect.
      if (!body?.forget && this.teardown.holdsResources(instance)) {
        throw new BadRequestError(
          `${instance.app}/${instance.env} still has a Worker, database or bucket that Lore created. Destroy those first, or pass \`forget\` to delete this copy and leave them - after which nothing will know their names.`,
        );
      }

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

    const [sigilRows, estateRows, deployedRows] = await Promise.all([
      sigilIds.length
        ? this.sigils.findMany({ where: { id: { inArray: sigilIds } } })
        : Promise.resolve([]),
      estateIds.length
        ? this.estates.findMany({ where: { id: { inArray: estateIds } } })
        : Promise.resolve([]),
      // ⚠️ Batched like the other two, not one query per row. The Apps list
      // renders every copy in the project from `currentInstancesAtom`, so a
      // per-row read here is a query per row of that table.
      this.deployments.findMany({
        where: {
          instanceId: { inArray: rows.map((row) => row.id) },
          status: { eq: "succeeded" },
        },
        orderBy: [{ column: "createdAt", direction: "desc" }],
      }),
    ]);

    const bySigil = new Map(sigilRows.map((row) => [row.id, row]));
    const byEstate = new Map(estateRows.map((row) => [row.id, row]));
    // Newest first, so the first entry per instance wins and later ones are
    // dropped. `set` would keep the OLDEST run, which is the whole answer
    // backwards.
    const byInstance = new Map<string, string>();
    for (const row of deployedRows) {
      if (!byInstance.has(row.instanceId)) {
        byInstance.set(row.instanceId, row.tag);
      }
    }

    return rows.map((row) =>
      this.project(
        row,
        row.sigilId ? bySigil.get(row.sigilId) : undefined,
        row.estateId ? byEstate.get(row.estateId) : undefined,
        byInstance.get(row.id),
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
    version?: string,
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
      // Exposed on purpose: whether a destroy may take this copy's database is
      // a property somebody should be able to READ before asking for one.
      ephemeral: instance.ephemeral,
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
      // Omitted rather than nulled for a copy that has never deployed: the
      // column is blank because there is no version, not because one is
      // unknown.
      ...(version ? { version } : {}),
    };
  }
}
