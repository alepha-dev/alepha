import {
  $ownsProject,
  LoreAudits,
  ProjectSecurityService,
} from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { organizationMembers, RankService } from "alepha/api/organizations";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $rateLimit } from "alepha/rate-limit";
import {
  $secure,
  OwnedResourceProvider,
  type UserAccountToken,
} from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";

import { type Host, hosts } from "../entities/hosts.ts";
import { cloudflareTokenSchema } from "../schemas/cloudflareCredentialSchema.ts";
import { hostEnrolmentSchema } from "../schemas/hostEnrolmentSchema.ts";
import {
  type HostInventoryResource,
  hostInventoryResourceSchema,
} from "../schemas/hostInventoryResourceSchema.ts";
import { hostMoveResultSchema } from "../schemas/hostMoveResultSchema.ts";
import { hostProvisionBodySchema } from "../schemas/hostProvisionBodySchema.ts";
import {
  type HostResource,
  hostResourceSchema,
  type MintedHost,
  mintedHostSchema,
} from "../schemas/hostResourceSchema.ts";
import {
  type OwnedHostResource,
  ownedHostResourceSchema,
} from "../schemas/ownedHostResourceSchema.ts";
import { HostCloudflareService } from "../services/HostCloudflareService.ts";
import { HostCommandTransport } from "../services/HostCommandTransport.ts";
import { HostInventoryService } from "../services/HostInventoryService.ts";
import { HostService } from "../services/HostService.ts";
import { HostStatsService } from "../services/HostStatsService.ts";
import { HostTokenService } from "../services/HostTokenService.ts";

export type {
  HostInventoryResource,
  HostResource,
  MintedHost,
  OwnedHostResource,
};

/**
 * One host, managed by the members of its home project (epic #E126): the
 * console at `/:projectSlug/hosts/:hostSlug` reads it here by id, and
 * `listMyHosts` answers the hosts of every project the caller can read
 * hosts in, for the CLI and MCP.
 *
 * Every action on `/hosts/:hostId` goes through `$ownsProject` on the
 * host row, which walks it to its home project by `projectId`, reads the
 * membership and checks the rank: `host:read` to look, `host:update` to
 * change or command it, `host:delete` to delete it. Every write also
 * passes `capability: "ship"`; reads pass none, by Lore's rule that turning a
 * capability off hides and never refuses a read. A non-member gets 403, not
 * the 404 the old owner filter answered: a host id is a UUID, so nothing
 * can be enumerated, and one gate matters more than the hidden 404. A host
 * with no home has a null `projectId`, and the gate refuses it to everybody.
 *
 * Creating one is the project's (`ProjectHostController.createProjectHost`):
 * a host cannot exist without a home.
 *
 * Both types are created here, and the difference is what a credential is.
 * A `bay` secret is one Lore mints and hands back once, so it is rotated; a
 * `cloudflare` token is one its owner pastes, so it is checked, sealed and
 * replaced. Neither is ever readable again, the owner included.
 */
export class HostController {
  protected readonly hosts = $repository(hosts);
  protected readonly service = $inject(HostService);
  protected readonly tokens = $inject(HostTokenService);
  protected readonly cloudflare = $inject(HostCloudflareService);
  protected readonly transport = $inject(HostCommandTransport);
  protected readonly inventories = $inject(HostInventoryService);
  protected readonly stats = $inject(HostStatsService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly audits = $inject(LoreAudits);
  protected readonly owned = $inject(OwnedResourceProvider);
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(organizationMembers);
  protected readonly ranks = $inject(RankService);
  protected readonly projectSecurity = $inject(ProjectSecurityService);

  /**
   * The gate on one host, by its home project's rank. A write names the
   * Apps capability, as every other Deploy write does; a read names none.
   * Declared above the actions: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected ownsHost = (requires: string, write = false) =>
    $ownsProject({
      repository: () => this.hosts,
      param: "hostId",
      requires,
      ...(write
        ? { capability: { key: "ship" as const, action: "manage a host" } }
        : {}),
    });

  /**
   * The host the gate just read.
   */
  protected host(): Host {
    return this.owned.get<Host>();
  }

  protected async reread(id: string): Promise<Host> {
    return this.hosts.getById(id);
  }

  protected async presentOne(
    host: Host,
    user: UserAccountToken,
  ): Promise<HostResource> {
    const [resource] = await this.service.present([host], user);
    return resource!;
  }

  /**
   * The polite limit on {@link refreshHost}, keyed per host. Declared
   * above the action because `middleware()` reads a field of this class.
   */
  protected readonly refreshLimit = $rateLimit({
    name: "lore:host-refresh",
    limit: 6,
    window: 60_000,
  });

  /**
   * The hosts of every project where the caller's rank grants
   * `host:read`, newest first, each with its home project, the projects
   * it is lent to and what the caller may do with it.
   *
   * One read of the caller's memberships and one of the projects behind
   * them; the permissions are computed once per project.
   */
  listMyHosts = $action({
    use: [$secure({ permissions: ["host:read"] })],
    method: "GET",
    path: "/hosts",
    schema: {
      response: z.object({ items: z.array(ownedHostResourceSchema) }),
    },
    handler: async ({ user }) => {
      const memberships = await this.members.findMany({
        where: { userId: { eq: user.id } },
        columns: ["organizationId"],
      });
      const organizationIds = memberships.map((row) => row.organizationId);
      const homes = organizationIds.length
        ? await this.projects.findMany({
            where: { organizationId: { inArray: organizationIds } },
            columns: ["id"],
          })
        : [];
      const readable: number[] = [];
      for (const home of homes) {
        const can = await this.service.hostPermissionsIn(home.id, user);
        if (can.includes("host:read")) {
          readable.push(home.id);
        }
      }
      const items = readable.length
        ? await this.hosts.findMany({
            where: { projectId: { inArray: readable } },
            orderBy: [{ column: "createdAt", direction: "desc" }],
          })
        : [];
      return { items: await this.service.withLoans(items, user) };
    },
  });

  /**
   * The projects the caller may create a host in: where their effective
   * permissions hold `host:create`, which also means the Apps capability is
   * on. What the account page's Add dialog offers.
   */
  listHostHomeChoices = $action({
    use: [$secure()],
    method: "GET",
    path: "/hosts/homes",
    schema: {
      response: z.object({
        items: z.array(
          z.object({
            id: z.integer(),
            title: z.string(),
            slug: z.string().optional(),
          }),
        ),
      }),
    },
    handler: async ({ user }) => {
      const memberships = await this.members.findMany({
        where: { userId: { eq: user.id } },
        columns: ["organizationId"],
      });
      const organizationIds = memberships.map((row) => row.organizationId);
      const candidates = organizationIds.length
        ? await this.projects.findMany({
            where: { organizationId: { inArray: organizationIds } },
            columns: ["id", "title", "slug"],
            orderBy: [{ column: "title", direction: "asc" }],
          })
        : [];
      const items = [];
      for (const project of candidates) {
        const can = await this.service.hostPermissionsIn(project.id, user);
        if (can.includes("host:create")) {
          items.push({
            id: project.id,
            title: project.title,
            ...(project.slug ? { slug: project.slug } : {}),
          });
        }
      }
      return { items };
    },
  });

  /**
   * One host, with its home project, the projects it is lent to and what
   * the machine last reported.
   *
   * The full shape rather than the bare resource: the console's Settings tab
   * needs the loans it detaches from. Resolved through the same `withLoans`
   * the list uses, so there is one place that knows how a loan is shaped.
   */
  getHost = $action({
    use: [this.ownsHost("host:read")],
    method: "GET",
    path: "/hosts/:hostId",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      response: ownedHostResourceSchema,
    },
    handler: async ({ user }) => {
      const [owned] = await this.service.withLoans([this.host()], user);
      return owned!;
    },
  });

  /**
   * What is running on the machine, reconciled against what Lore tracks.
   *
   * ⚠️ A machine that has never connected answers `{ inventory: null }` and
   * NOT a 404. "Nothing reported yet" is a state the console renders, and the
   * `expected` list is still worth showing beside it: those are the instances
   * Lore believes belong here.
   *
   * For the members of the home project. A member of a project the host is
   * only lent to is refused: what runs on a machine includes other
   * projects' copies.
   */
  getHostInventory = $action({
    use: [this.ownsHost("host:read")],
    method: "GET",
    path: "/hosts/:hostId/inventory",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      response: hostInventoryResourceSchema,
    },
    handler: async () => this.inventories.reconcile(this.host()),
  });

  /**
   * The CPU and memory series, one point per day.
   *
   * `HostStatsService.series` was written for #Q1627 and had no caller in
   * the tree until this route: it divides the dataset's sums by the sample
   * count and carries the `estimated` / `sampleInterval` disclosure, and both
   * halves of that stay there rather than being redone here. On Analytics
   * Engine a window is SAMPLED, and a chart that hides its own sampling is one
   * that gets trusted more than it deserves.
   *
   * ⚠️ `since` is declared in `schema.query` and has to be: a `$page` loader's
   * `query` holds only what the schema declares, so an undeclared param reads
   * `undefined` and the page takes whichever branch that implies, silently.
   *
   * ⚠️ The series is off by default (`collectSeries`), so an empty answer is
   * the common case rather than an error. The page says which of the two it
   * is; this route answers what the dataset holds either way.
   */
  getHostStats = $action({
    use: [this.ownsHost("host:read")],
    method: "GET",
    path: "/hosts/:hostId/stats",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      query: z.object({ since: z.string().max(40).optional() }),
      response: z.object({
        collecting: z.boolean(),
        estimated: z.boolean(),
        sampleInterval: z.number().optional(),
        points: z.array(
          z.object({
            day: z.string().max(40),
            cpuPercent: z.number(),
            memoryPercent: z.number(),
            samples: z.integer().min(0),
          }),
        ),
      }),
    },
    handler: async ({ query }) => {
      const host = this.host();
      // Thirty days by default: the dataset rolls up by day, so a shorter
      // window is a handful of points and a longer one outlives the hot
      // retention.
      const since =
        query.since ??
        new Date(this.dateTime.nowMillis() - 30 * 24 * 3600_000).toISOString();
      const series = await this.stats.series(host.id, since);
      // The switch travels with the answer so the page can tell "collecting,
      // nothing yet" from "not collecting at all" without a second read.
      return { collecting: host.collectSeries, ...series };
    },
  });

  /**
   * Ask the machine for a fresh inventory, instead of waiting up to half an
   * hour for its next tick.
   *
   * ⚠️ **The answer is asynchronous, and nothing here may pretend otherwise.**
   * The Worker cannot read a Durable Object socket's reply: it emits into the
   * room and the machine's answer arrives later, on the machine's own
   * connection, through the ordinary `inventory` path. So this returns
   * "asked", and the page re-reads {@link getHostInventory} a moment later.
   * A promise that resolved with the inventory would be a lie about the
   * transport.
   *
   * ⚠️ **Not a command, deliberately.** A row buys idempotency, a queue, an
   * ack, redelivery and a sweep, and none of that is worth having here: the
   * failure mode of a lost refresh is that somebody clicks again.
   *
   * Refused rather than silently dropped while the machine is offline. A
   * transient frame pushed into nothing would report success for something
   * that will never happen.
   *
   * The limit is per host rather than per caller: the cost being bounded is
   * the machine's, and one owner with two tabs is the same machine. Bay's own
   * 5 s coalescing is the hard floor; this is the polite one.
   */
  refreshHost = $action({
    use: [
      this.ownsHost("host:update", true),
      this.refreshLimit.middleware({
        key: (input: { params: { hostId: string } }) =>
          `host-refresh:${input.params.hostId}`,
      }),
    ],
    method: "POST",
    path: "/hosts/:hostId/refresh",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      response: z.object({ asked: z.boolean() }),
    },
    handler: async () => {
      const host = this.host();
      if (!this.service.isOnline(host)) {
        throw new BadRequestError(
          `Host "${host.slug}" is not connected right now, so there is nothing to ask`,
        );
      }
      // `false` here is the race between the liveness stamps and the socket
      // actually being there. Reported rather than thrown: nothing was lost,
      // and the next tick answers anyway.
      return { asked: await this.transport.push(host, { type: "query" }) };
    },
  });

  /**
   * Change the label or the switches. An omitted key means leave it alone.
   *
   * ⚠️ There is no `slug` here, and that is the rename rule: the slug is an
   * identifier a config may record, so it is never writable after creation.
   * A `slug` in the body is stripped by the schema rather than refused,
   * because the label is what a rename is.
   */
  updateHost = $action({
    use: [this.ownsHost("host:update", true)],
    method: "PATCH",
    path: "/hosts/:hostId",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      body: z.object({
        label: z.string().max(100).optional(),
        collectSeries: z.boolean().optional(),
        deployAllowed: z.boolean().optional(),
        statsIntervalSeconds: z.integer().min(60).max(86_400).optional(),
        /**
         * How long from now the host is meant to live, in seconds (#Q3138);
         * `null` clears the expiry. Either way the overdue notification is
         * re-armed.
         */
        ttlSeconds: z
          .integer()
          .min(60)
          .max(366 * 86_400)
          .nullable()
          .optional(),
      }),
      response: hostResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const host = this.host();

      await this.hosts.updateById(host.id, {
        ...(body.label === undefined
          ? {}
          : { label: body.label.trim() || null }),
        ...(body.collectSeries === undefined
          ? {}
          : { collectSeries: body.collectSeries }),
        ...(body.deployAllowed === undefined
          ? {}
          : { deployAllowed: body.deployAllowed }),
        ...(body.statsIntervalSeconds === undefined
          ? {}
          : { statsIntervalSeconds: body.statsIntervalSeconds }),
        ...(body.ttlSeconds === undefined
          ? {}
          : {
              expiresAt:
                body.ttlSeconds === null
                  ? null
                  : new Date(
                      this.dateTime.nowMillis() + body.ttlSeconds * 1000,
                    ).toISOString(),
              notifiedOverdueAt: null,
            }),
      });

      await this.audits.host.logSuccess("update", {
        ...this.audits.actor(user),
        resourceType: "host",
        resourceId: host.id,
        description: host.slug,
        metadata: { fields: Object.keys(body) },
      });

      const updated = await this.reread(host.id);
      // The machine caches what `welcome` told it, so a switch it acts on
      // (deploys, the gauge interval) is pushed as `config` the moment it
      // changes. Best effort: an offline machine learns it from its next
      // `welcome`, and the label is nothing the machine reads.
      // A cloudflare host has no machine and no socket, so there is
      // nothing to tell: offering the transport a row it can never reach
      // would queue a push against a host that has no connector.
      if (
        updated.type === "bay" &&
        (body.deployAllowed !== undefined ||
          body.statsIntervalSeconds !== undefined)
      ) {
        await this.transport.push(
          updated,
          this.service.welcomeFrame(updated, "config"),
        );
      }
      return this.presentOne(updated, user);
    },
  });

  /**
   * Replace the secret, keeping the row and everything lent through it.
   *
   * This is what revoking a leaked secret costs. The old secret stops
   * resolving the moment the hash changes, because `HostTokenService.verify`
   * looks the host up BY its hash; the connector holding the old one is
   * refused on its next dial (#1782) and nothing is handed over.
   */
  rotateHost = $action({
    use: [this.ownsHost("host:update", true)],
    method: "POST",
    path: "/hosts/:hostId/rotate",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      response: mintedHostSchema,
    },
    handler: async ({ params, user }) => {
      const host = this.host();
      if (host.type !== "bay") {
        throw new BadRequestError(
          "Only a bay host holds a secret Lore minted; replace a cloudflare token with POST /hosts/:hostId/credential",
        );
      }

      const minted = await this.tokens.mint();
      await this.hosts.updateById(host.id, {
        secretHash: minted.hash,
        secretPrefix: minted.prefix,
      });

      // The one UPDATE in the audit set with a warning: rotating is what
      // revoking a leaked secret looks like, and "when was this rotated" is
      // the question asked after the leak is found.
      await this.audits.host.logSuccess("rotate", {
        ...this.audits.actor(user),
        severity: "warning",
        resourceType: "host",
        resourceId: host.id,
        description: host.slug,
      });

      const rotated = await this.reread(host.id);
      return {
        ...(await this.presentOne(rotated, user)),
        secret: minted.secret,
      };
    },
  });

  /**
   * Mint a one-time enrolment secret for a bay host (#Q3165), the one
   * `lore host provision` puts in a server's cloud-init. Valid
   * {@link HostTokenService.ENROLMENT_TTL_MILLIS}, and until the machine
   * first connects with the long-lived secret it is exchanged for. Minting
   * another replaces the previous one; the long-lived secret is untouched
   * until a machine exchanges it.
   */
  createHostEnrolment = $action({
    use: [this.ownsHost("host:update", true)],
    method: "POST",
    path: "/hosts/:hostId/enrolment",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      response: hostEnrolmentSchema,
    },
    handler: async ({ params, user }) => {
      const host = this.host();
      if (host.type !== "bay") {
        throw new BadRequestError(
          "Only a bay host enrols a machine; a cloudflare host holds a token instead",
        );
      }
      const minted = await this.tokens.mintEnrolment();
      const expiresAt = new Date(
        this.dateTime.nowMillis() + HostTokenService.ENROLMENT_TTL_MILLIS,
      ).toISOString();
      await this.hosts.updateById(host.id, {
        enrolmentHash: minted.hash,
        enrolmentExpiresAt: expiresAt,
      });
      return { secret: minted.secret, expiresAt };
    },
  });

  /**
   * Record the server `lore host provision` bought for a bay host
   * (#Q3166): the provider, the server's id, type and zone, and the hourly
   * price read from the catalogue. Lore holds no provider key, so this is a
   * record and nothing more: the CLI creates and terminates the server.
   */
  recordHostProvision = $action({
    use: [this.ownsHost("host:update", true)],
    method: "POST",
    path: "/hosts/:hostId/provision",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      body: hostProvisionBodySchema,
      response: hostResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const host = this.host();
      if (host.type !== "bay") {
        throw new BadRequestError(
          "Only a bay host runs on a server Lore provisions",
        );
      }
      await this.hosts.updateById(host.id, {
        provider: body.provider,
        providerServerId: body.serverId,
        providerServerType: body.type,
        providerZone: body.zone,
        ...(body.hourlyPrice === undefined
          ? {}
          : { hourlyPrice: body.hourlyPrice }),
        provisionedAt: new Date(this.dateTime.nowMillis()).toISOString(),
      });
      return this.presentOne(await this.reread(host.id), user);
    },
  });

  /**
   * Replace the token on a cloudflare host.
   *
   * Write-only: there is no GET that returns the token and no PATCH that
   * carries it, so replacing is never a read-modify-write through the
   * client. Checked before it is written and **all or nothing** on a
   * failure, so the token the owner already had keeps working when the new
   * one does not (#1630).
   *
   * Audited as `rotate`, the verb `LoreAudits.host` already declares, with
   * the same `warning` severity as the bay rotation: "when was this
   * credential last changed" is one question, whichever kind it was. The UI
   * says "Replace token"; the Activity filter does not grow a verb.
   */
  replaceHostCredential = $action({
    use: [this.ownsHost("host:update", true)],
    method: "POST",
    path: "/hosts/:hostId/credential",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      body: z.object({ token: cloudflareTokenSchema }),
      response: hostResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const host = this.host();
      const replaced = await this.service.replaceCredential(
        user,
        host,
        body.token,
      );
      return this.presentOne(replaced, user);
    },
  });

  /**
   * Ask Cloudflare again, now, and record what it said.
   *
   * The owner's own button, for the case the nightly sweep would otherwise
   * answer up to a day later: they have just widened a token at Cloudflare
   * and want the host to agree. An inconclusive answer leaves the row
   * untouched and says so, exactly as the sweep does.
   */
  checkHostCredential = $action({
    use: [this.ownsHost("host:update", true)],
    method: "POST",
    path: "/hosts/:hostId/credential/check",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      response: hostResourceSchema,
    },
    handler: async ({ params, user }) => {
      const host = this.host();
      if (host.type !== "cloudflare") {
        throw new BadRequestError(
          "Only a cloudflare host has a token to check",
        );
      }

      const check = await this.cloudflare.recheck(host);
      if (check.outcome === "inconclusive") {
        // No verdict, so no row change and no pretending otherwise: the
        // drawer shows this sentence and the host keeps the status it
        // had.
        throw new BadRequestError(check.message);
      }

      return this.presentOne(await this.reread(host.id), user);
    },
  });

  /**
   * Move a host to another project (#Q3280): `host:delete` in the home
   * it leaves (the gate) and `host:create` in the target. The rules of the
   * target and of the row are `HostService.rehome`'s; the loans are not
   * touched, and the answer lists them, so the mover knows what still
   * deploys there.
   */
  moveHost = $action({
    use: [this.ownsHost("host:delete", true)],
    method: "POST",
    path: "/hosts/:hostId/move",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      body: z.object({ projectId: z.integer() }),
      response: hostMoveResultSchema,
    },
    handler: async ({ body, user }) => {
      const host = this.host();
      // ⚠️ ranks: imperative. The target is a project the path does not name.
      await this.ranks.assert(
        await this.projectSecurity.organizationIdOf(body.projectId),
        "host:create",
        user,
      );
      const { host: moved, from } = await this.service.rehome(
        host,
        body.projectId,
      );
      for (const projectId of [from, body.projectId]) {
        if (projectId === undefined) continue;
        await this.audits.host.logSuccess("move", {
          ...this.audits.actor(user),
          ...this.audits.scope(projectId),
          severity: "warning",
          resourceType: "host",
          resourceId: host.id,
          description: host.slug,
          metadata: { from: from ?? null, to: body.projectId },
        });
      }
      const serverElsewhere =
        !!moved.provider &&
        !!moved.createdBy &&
        !(await this.members.findOne({
          where: {
            organizationId: {
              eq: await this.projectSecurity.organizationIdOf(body.projectId),
            },
            userId: { eq: moved.createdBy },
          },
        }));
      return {
        host: await this.presentOne(moved, user),
        loans: await this.service.loansOf(host.id),
        serverElsewhere,
      };
    },
  });

  /**
   * Whether {@link deleteHost} would accept, without deleting (#Q3167):
   * the same `assertUnreferenced` refusal, naming what still deploys there.
   * `lore host delete` asks this before it terminates a provisioned
   * server, so a delete Lore would refuse never destroys the machine first.
   */
  checkHostDeletable = $action({
    use: [this.ownsHost("host:delete")],
    method: "GET",
    path: "/hosts/:hostId/deletable",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const host = this.host();
      await this.service.assertUnreferenced(host.id);
      return { ok: true };
    },
  });

  /**
   * Remove a host.
   *
   * Refused while an app instance anywhere points at it
   * (`assertUnreferenced`, #1767). Deleting undeploys nothing: the VPS keeps
   * running and Lore only loses the ability to inspect, redeploy or roll
   * back, which the dialog says because the intuitive reading is the
   * opposite. A provisioned server is terminated by the CLI before it calls
   * this (#Q3167): Lore holds no provider key, so this row delete alone
   * leaves that server billing. For a `bay` host the row IS the credential, so deleting it
   * revokes; the lending join cascades with it.
   */
  deleteHost = $action({
    use: [this.ownsHost("host:delete", true)],
    method: "DELETE",
    path: "/hosts/:hostId",
    schema: {
      params: z.object({ hostId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const host = this.host();
      await this.service.assertUnreferenced(host.id);

      await this.hosts.deleteById(host.id);

      await this.audits.host.logSuccess("delete", {
        ...this.audits.actor(user),
        severity: "warning",
        resourceType: "host",
        resourceId: host.id,
        description: host.slug,
      });

      return { ok: true };
    },
  });

  /**
   * What deleting the caller's account would take with it.
   *
   * A question beside `UserDeletionHook.countMyAuthoredQuests`, for the same
   * dialog: a host with no home is still anchored on the account of the
   * person who created it, and goes with it (the deliberate exception to the
   * refuse-while-referenced rule, because an account deletion must not be
   * blockable by other people's projects). A homed host outlives it. So
   * only the first kind is counted, before the click rather than after.
   */
  countMyHosts = $action({
    use: [$secure()],
    method: "GET",
    path: "/users/me/hosts",
    description:
      "How many hosts with no project go with the caller's account, and how many projects they are lent to",
    schema: {
      response: z.object({ hosts: z.integer(), projects: z.integer() }),
    },
    handler: async ({ user }) => this.service.countOwned(user.id),
  });
}
