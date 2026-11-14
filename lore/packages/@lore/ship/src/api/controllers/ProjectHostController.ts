import {
  $ownsProject,
  LoreAudits,
  ProjectSecurityService,
} from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { RankService } from "alepha/api/organizations";
import { $repository } from "alepha/orm";
import { $secure, type UserAccountToken } from "alepha/security";
import {
  $action,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import { hostProjects } from "../entities/hostProjects.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import { createHostBodySchema } from "../schemas/createHostBodySchema.ts";
import {
  type LentHostResource,
  lentHostResourceSchema,
  type MintedLentHost,
  mintedLentHostSchema,
} from "../schemas/lentHostResourceSchema.ts";
import { ownedHostResourceSchema } from "../schemas/ownedHostResourceSchema.ts";
import { HostCloudflareService } from "../services/HostCloudflareService.ts";
import { HostService } from "../services/HostService.ts";

export type { LentHostResource, MintedLentHost };

/**
 * The lending, from the project's side: which hosts this project may
 * deploy through, and who may change that.
 *
 * A host has a home project, whose members manage it by their rank, and
 * loans, the projects that may deploy onto it (epic #E126). The two are
 * different facts: the home usually holds a loan too, and need not.
 *
 * ## The trust statement this controller enforces
 *
 * Attaching is a grant, and a bigger one than it looks: whoever can deploy in
 * the borrowing project can then run code on the machine, or inside the
 * Cloudflare account, with its storage and secrets bound to it. So attaching
 * needs `host:lend` on both sides: in the borrowing project (it changes
 * what the project can deploy to) and in the host's home project (it
 * exposes the home's machine). One check when they are the same project.
 * `host:lend` is on nobody by default, so widening that is a rank carrying
 * it, and folio #1198 records the owner's decision to start narrow.
 *
 * Detaching takes either side: the borrower is giving up a capability, the
 * home is withdrawing a loan. Both are legitimate and neither undeploys
 * anything.
 *
 * ## What a member may learn
 *
 * A member of a borrowing project sees THAT the project holds a host
 * called `ovh-1`, which project it belongs to, and whether the machine is up;
 * its console answers them 403 unless they are a member of the home too.
 */
export class ProjectHostController {
  protected readonly hosts = $repository(hosts);
  protected readonly grants = $repository(hostProjects);
  protected readonly projects = $repository(projects);
  protected readonly ranks = $inject(RankService);
  protected readonly projectSecurity = $inject(ProjectSecurityService);
  protected readonly service = $inject(HostService);
  protected readonly cloudflare = $inject(HostCloudflareService);
  protected readonly audits = $inject(LoreAudits);

  /**
   * Every host this project may deploy onto, newest loan first: the deploy
   * targets the app, stack and artifact pickers offer. Member-readable,
   * because "where can this project deploy" is a question every member may
   * ask. Each row names its home project and says whether that is this one;
   * a host homed here and not lent here is not a deploy target, and is in
   * {@link listHomeHosts}.
   */
  listProjectHosts = $action({
    use: [$ownsProject({ requires: "host:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/hosts",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(lentHostResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      return { items: await this.lentTo(params.projectId, user) };
    },
  });

  /**
   * Every host this project is the home of, lent to it or not, newest
   * first, with its loans and what the caller may do with it.
   */
  listHomeHosts = $action({
    use: [$ownsProject({ requires: "host:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/hosts/home",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(ownedHostResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      const rows = await this.hosts.findMany({
        where: { projectId: { eq: params.projectId } },
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });
      return { items: await this.service.withLoans(rows, user) };
    },
  });

  /**
   * One host of this project, by its slug: what the console at
   * `/:projectSlug/hosts/:hostSlug` opens. A slug is unique per home
   * project (#E126), so the pair names one host. A host only lent here
   * is not found: its console lives under its own home.
   */
  getHomeHost = $action({
    use: [$ownsProject({ requires: "host:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/hosts/home/:hostSlug",
    schema: {
      params: z.object({ projectId: z.integer(), hostSlug: z.string() }),
      response: ownedHostResourceSchema,
    },
    handler: async ({ params, user }) => {
      const row = await this.hosts.findOne({
        where: {
          projectId: { eq: params.projectId },
          slug: { eq: params.hostSlug },
        },
      });
      if (!row) {
        throw new NotFoundError("Host not found");
      }
      const [owned] = await this.service.withLoans([row], user);
      return owned!;
    },
  });

  /**
   * Lend a host to this project. Takes `host:lend` here (the gate) and
   * in the host's home project.
   */
  attachHost = $action({
    use: [
      $ownsProject({
        requires: "host:lend",
        param: "projectId",
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/hosts",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({ hostId: z.uuid() }),
      response: lentHostResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const host = await this.hosts.findById(body.hostId);
      if (!host || host.projectId == null) {
        throw new NotFoundError("Host not found");
      }
      if (host.projectId !== params.projectId) {
        // ⚠️ ranks: imperative. The second half of the trust statement: the
        // home's rank, asked of a project the path does not name.
        await this.ranks.assert(
          await this.projectSecurity.organizationIdOf(host.projectId),
          "host:lend",
          user,
        );
      }
      return this.lend(params.projectId, host, user);
    },
  });

  /**
   * Create a host in this project, its home, and lend it here in the same
   * step: the one way a host comes to exist (#Q3279). `host:create`,
   * with the Apps capability on, since a host homed in a project without
   * it could be managed through no page. The body is
   * `createHostBodySchema`: a bay host hands its secret back exactly
   * once, a cloudflare host hands back nothing because the caller already
   * holds the token.
   */
  createProjectHost = $action({
    use: [
      $ownsProject({
        requires: "host:create",
        param: "projectId",
        capability: { key: "ship", action: "create a host" },
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/hosts/new",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: createHostBodySchema,
      response: mintedLentHostSchema,
    },
    handler: async ({ params, body, user }) => {
      if (body.type === "cloudflare") {
        const { host } = await this.service.createCloudflare(
          user,
          params.projectId,
          body,
        );
        return this.lend(params.projectId, host, user);
      }
      const { host, secret } = await this.service.createBay(
        user,
        params.projectId,
        body,
      );
      return { ...(await this.lend(params.projectId, host, user)), secret };
    },
  });

  /**
   * Withdraw the loan. Refused while an app instance in this project points
   * at the host (`assertUnreferenced`, #1767), so nothing silently stops
   * being deployable.
   */
  detachHost = $action({
    use: [$secure({ permissions: ["host:lend"] })],
    method: "DELETE",
    path: "/projects/:projectId/hosts/:hostId",
    schema: {
      params: z.object({ projectId: z.integer(), hostId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const grant = await this.grants.findOne({
        where: {
          projectId: { eq: params.projectId },
          hostId: { eq: params.hostId },
        },
      });
      if (!grant) {
        throw new NotFoundError("Host not lent to this project");
      }
      const host = await this.hosts.getOne({
        where: { id: { eq: params.hostId } },
      });
      // ⚠️ ranks: imperative, and an OR a middleware cannot express: either
      // side of the loan may end it, the borrower or the home.
      const mayLend = await this.ranks.can(
        await this.projectSecurity.organizationIdOf(params.projectId),
        "host:lend",
        user,
      );
      const homeMayLend =
        !mayLend && host.projectId != null
          ? await this.ranks.can(
              await this.projectSecurity.organizationIdOf(host.projectId),
              "host:lend",
              user,
            )
          : false;
      if (!mayLend && !homeMayLend) {
        throw new ForbiddenError(
          "Detaching a host needs host:lend in this project or in the host's home project",
        );
      }

      await this.service.assertUnreferenced(host.id, params.projectId);
      await this.grants.deleteById(grant.id);

      await this.audits.host.logSuccess("detach", {
        ...this.audits.actor(user),
        ...this.audits.scope(params.projectId),
        resourceType: "host",
        resourceId: host.id,
        description: host.slug,
      });

      return { ok: true };
    },
  });

  /**
   * Records the grant, once. The unique index on `(hostId, projectId)` is
   * what guarantees it; the read explains the refusal in words.
   */
  protected async lend(
    projectId: number,
    host: Host,
    user: UserAccountToken,
  ): Promise<LentHostResource> {
    const existing = await this.grants.findOne({
      where: { projectId: { eq: projectId }, hostId: { eq: host.id } },
    });
    if (existing) {
      throw new ConflictError(`"${host.slug}" is already lent to this project`);
    }

    const grant = await this.grants.create({
      projectId,
      hostId: host.id,
      createdBy: user.id,
    });

    await this.audits.host.logSuccess("attach", {
      ...this.audits.actor(user),
      ...this.audits.scope(projectId),
      resourceType: "host",
      resourceId: host.id,
      description: host.slug,
    });

    const [lent] = await this.toLent(
      [{ host, lentAt: String(grant.createdAt) }],
      projectId,
      user,
    );
    return lent!;
  }

  protected async lentTo(
    projectId: number,
    user: UserAccountToken,
  ): Promise<LentHostResource[]> {
    const grants = await this.grants.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
    });
    if (grants.length === 0) {
      return [];
    }
    const rows = await this.hosts.findMany({
      where: { id: { inArray: grants.map((grant) => grant.hostId) } },
    });
    return this.toLent(
      grants.flatMap((grant) => {
        const host = rows.find((row) => row.id === grant.hostId);
        return host ? [{ host, lentAt: String(grant.createdAt) }] : [];
      }),
      projectId,
      user,
    );
  }

  /**
   * What a member of the borrowing project may see of a host: built field
   * by field, so a column added to `hosts` has to be a decision to show it
   * here. One read of the home projects for the whole list, and the reader's
   * permissions computed once per home.
   */
  protected async toLent(
    loans: Array<{ host: Host; lentAt: string }>,
    projectId: number,
    user: UserAccountToken,
  ): Promise<LentHostResource[]> {
    const homeIds = [
      ...new Set(
        loans.flatMap(({ host }) =>
          host.projectId == null ? [] : [host.projectId],
        ),
      ),
    ];
    const homes = homeIds.length
      ? await this.projects.findMany({
          where: { id: { inArray: homeIds } },
          columns: ["id", "title", "slug"],
        })
      : [];
    const can = new Map<number, string[]>();
    for (const homeId of homeIds) {
      can.set(homeId, await this.service.hostPermissionsIn(homeId, user));
    }
    return loans.map(({ host, lentAt }) => {
      const home = homes.find((project) => project.id === host.projectId);
      return {
        id: host.id,
        slug: host.slug,
        label: host.label ?? undefined,
        type: host.type,
        online: this.service.isOnline(host),
        deployAllowed: host.deployAllowed,
        acceptedRuntimes: this.service.acceptedRuntimes(host.type),
        credentialStatus: this.cloudflare.credentialStatus(host),
        lastSeenAt: host.lastSeenAt ?? undefined,
        expiresAt: host.expiresAt ?? undefined,
        overdue: this.service.isOverdue(host),
        publicIp: host.publicIp ?? undefined,
        provider: host.provider ?? undefined,
        providerServerType: host.providerServerType ?? undefined,
        cpuPercent: host.cpuPercent ?? undefined,
        memoryPercent: host.memoryPercent ?? undefined,
        ...(home
          ? {
              home: {
                id: home.id,
                title: home.title,
                ...(home.slug ? { slug: home.slug } : {}),
              },
            }
          : {}),
        isHome: host.projectId === projectId,
        can: host.projectId == null ? [] : (can.get(host.projectId) ?? []),
        lentAt,
      };
    });
  }
}
