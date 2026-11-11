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

import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { createEstateBodySchema } from "../schemas/createEstateBodySchema.ts";
import {
  type LentEstateResource,
  lentEstateResourceSchema,
  type MintedLentEstate,
  mintedLentEstateSchema,
} from "../schemas/lentEstateResourceSchema.ts";
import { ownedEstateResourceSchema } from "../schemas/ownedEstateResourceSchema.ts";
import { EstateCloudflareService } from "../services/EstateCloudflareService.ts";
import { EstateService } from "../services/EstateService.ts";

export type { LentEstateResource, MintedLentEstate };

/**
 * The lending, from the project's side: which estates this project may
 * deploy through, and who may change that.
 *
 * An estate has a home project, whose members manage it by their rank, and
 * loans, the projects that may deploy onto it (epic #E126). The two are
 * different facts: the home usually holds a loan too, and need not.
 *
 * ## The trust statement this controller enforces
 *
 * Attaching is a grant, and a bigger one than it looks: whoever can deploy in
 * the borrowing project can then run code on the machine, or inside the
 * Cloudflare account, with its storage and secrets bound to it. So attaching
 * needs `estate:lend` on both sides: in the borrowing project (it changes
 * what the project can deploy to) and in the estate's home project (it
 * exposes the home's machine). One check when they are the same project.
 * `estate:lend` is on nobody by default, so widening that is a rank carrying
 * it, and folio #1198 records the owner's decision to start narrow.
 *
 * Detaching takes either side: the borrower is giving up a capability, the
 * home is withdrawing a loan. Both are legitimate and neither undeploys
 * anything.
 *
 * ## What a member may learn
 *
 * A member of a borrowing project sees THAT the project holds an estate
 * called `ovh-1`, which project it belongs to, and whether the machine is up;
 * its console answers them 403 unless they are a member of the home too.
 */
export class ProjectEstateController {
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly projects = $repository(projects);
  protected readonly ranks = $inject(RankService);
  protected readonly projectSecurity = $inject(ProjectSecurityService);
  protected readonly service = $inject(EstateService);
  protected readonly cloudflare = $inject(EstateCloudflareService);
  protected readonly audits = $inject(LoreAudits);

  /**
   * Every estate this project may deploy onto, newest loan first: the deploy
   * targets the app, stack and artifact pickers offer. Member-readable,
   * because "where can this project deploy" is a question every member may
   * ask. Each row names its home project and says whether that is this one;
   * an estate homed here and not lent here is not a deploy target, and is in
   * {@link listHomeEstates}.
   */
  listProjectEstates = $action({
    use: [$ownsProject({ requires: "estate:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/estates",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(lentEstateResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      return { items: await this.lentTo(params.projectId, user) };
    },
  });

  /**
   * Every estate this project is the home of, lent to it or not, newest
   * first, with its loans and what the caller may do with it.
   */
  listHomeEstates = $action({
    use: [$ownsProject({ requires: "estate:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/estates/home",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(ownedEstateResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      const rows = await this.estates.findMany({
        where: { projectId: { eq: params.projectId } },
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });
      return { items: await this.service.withLoans(rows, user) };
    },
  });

  /**
   * Lend an estate to this project. Takes `estate:lend` here (the gate) and
   * in the estate's home project.
   */
  attachEstate = $action({
    use: [
      $ownsProject({
        requires: "estate:lend",
        param: "projectId",
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/estates",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({ estateId: z.uuid() }),
      response: lentEstateResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const estate = await this.estates.findById(body.estateId);
      if (!estate || estate.projectId == null) {
        throw new NotFoundError("Estate not found");
      }
      if (estate.projectId !== params.projectId) {
        // ⚠️ ranks: imperative. The second half of the trust statement: the
        // home's rank, asked of a project the path does not name.
        await this.ranks.assert(
          await this.projectSecurity.organizationIdOf(estate.projectId),
          "estate:lend",
          user,
        );
      }
      return this.lend(params.projectId, estate, user);
    },
  });

  /**
   * Create an estate in this project, its home, and lend it here in the same
   * step: the one way an estate comes to exist (#Q3279). `estate:create`,
   * with the Apps capability on, since an estate homed in a project without
   * it could be managed through no page. The body is
   * `createEstateBodySchema`: a bay estate hands its secret back exactly
   * once, a cloudflare estate hands back nothing because the caller already
   * holds the token.
   */
  createProjectEstate = $action({
    use: [
      $ownsProject({
        requires: "estate:create",
        param: "projectId",
        capability: { key: "apps", action: "create an estate" },
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/estates/new",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: createEstateBodySchema,
      response: mintedLentEstateSchema,
    },
    handler: async ({ params, body, user }) => {
      if (body.type === "cloudflare") {
        const { estate } = await this.service.createCloudflare(
          user,
          params.projectId,
          body,
        );
        return this.lend(params.projectId, estate, user);
      }
      const { estate, secret } = await this.service.createBay(
        user,
        params.projectId,
        body,
      );
      return { ...(await this.lend(params.projectId, estate, user)), secret };
    },
  });

  /**
   * Withdraw the loan. Refused while an app instance in this project points
   * at the estate (`assertUnreferenced`, #1767), so nothing silently stops
   * being deployable.
   */
  detachEstate = $action({
    use: [$secure({ permissions: ["estate:lend"] })],
    method: "DELETE",
    path: "/projects/:projectId/estates/:estateId",
    schema: {
      params: z.object({ projectId: z.integer(), estateId: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const grant = await this.grants.findOne({
        where: {
          projectId: { eq: params.projectId },
          estateId: { eq: params.estateId },
        },
      });
      if (!grant) {
        throw new NotFoundError("Estate not lent to this project");
      }
      const estate = await this.estates.getOne({
        where: { id: { eq: params.estateId } },
      });
      // ⚠️ ranks: imperative, and an OR a middleware cannot express: either
      // side of the loan may end it, the borrower or the home.
      const mayLend = await this.ranks.can(
        await this.projectSecurity.organizationIdOf(params.projectId),
        "estate:lend",
        user,
      );
      const homeMayLend =
        !mayLend && estate.projectId != null
          ? await this.ranks.can(
              await this.projectSecurity.organizationIdOf(estate.projectId),
              "estate:lend",
              user,
            )
          : false;
      if (!mayLend && !homeMayLend) {
        throw new ForbiddenError(
          "Detaching an estate needs estate:lend in this project or in the estate's home project",
        );
      }

      await this.service.assertUnreferenced(estate.id, params.projectId);
      await this.grants.deleteById(grant.id);

      await this.audits.estate.logSuccess("detach", {
        ...this.audits.actor(user),
        ...this.audits.scope(params.projectId),
        resourceType: "estate",
        resourceId: estate.id,
        description: estate.slug,
      });

      return { ok: true };
    },
  });

  /**
   * Records the grant, once. The unique index on `(estateId, projectId)` is
   * what guarantees it; the read explains the refusal in words.
   */
  protected async lend(
    projectId: number,
    estate: Estate,
    user: UserAccountToken,
  ): Promise<LentEstateResource> {
    const existing = await this.grants.findOne({
      where: { projectId: { eq: projectId }, estateId: { eq: estate.id } },
    });
    if (existing) {
      throw new ConflictError(
        `"${estate.slug}" is already lent to this project`,
      );
    }

    const grant = await this.grants.create({
      projectId,
      estateId: estate.id,
      createdBy: user.id,
    });

    await this.audits.estate.logSuccess("attach", {
      ...this.audits.actor(user),
      ...this.audits.scope(projectId),
      resourceType: "estate",
      resourceId: estate.id,
      description: estate.slug,
    });

    const [lent] = await this.toLent(
      [{ estate, lentAt: String(grant.createdAt) }],
      projectId,
      user,
    );
    return lent!;
  }

  protected async lentTo(
    projectId: number,
    user: UserAccountToken,
  ): Promise<LentEstateResource[]> {
    const grants = await this.grants.findMany({
      where: { projectId: { eq: projectId } },
      orderBy: [{ column: "createdAt", direction: "desc" }],
    });
    if (grants.length === 0) {
      return [];
    }
    const rows = await this.estates.findMany({
      where: { id: { inArray: grants.map((grant) => grant.estateId) } },
    });
    return this.toLent(
      grants.flatMap((grant) => {
        const estate = rows.find((row) => row.id === grant.estateId);
        return estate ? [{ estate, lentAt: String(grant.createdAt) }] : [];
      }),
      projectId,
      user,
    );
  }

  /**
   * What a member of the borrowing project may see of an estate: built field
   * by field, so a column added to `estates` has to be a decision to show it
   * here. One read of the home projects for the whole list, and the reader's
   * permissions computed once per home.
   */
  protected async toLent(
    loans: Array<{ estate: Estate; lentAt: string }>,
    projectId: number,
    user: UserAccountToken,
  ): Promise<LentEstateResource[]> {
    const homeIds = [
      ...new Set(
        loans.flatMap(({ estate }) =>
          estate.projectId == null ? [] : [estate.projectId],
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
      can.set(homeId, await this.service.estatePermissionsIn(homeId, user));
    }
    return loans.map(({ estate, lentAt }) => {
      const home = homes.find((project) => project.id === estate.projectId);
      return {
        id: estate.id,
        slug: estate.slug,
        label: estate.label ?? undefined,
        type: estate.type,
        online: this.service.isOnline(estate),
        deployAllowed: estate.deployAllowed,
        acceptedRuntimes: this.service.acceptedRuntimes(estate.type),
        credentialStatus: this.cloudflare.credentialStatus(estate),
        lastSeenAt: estate.lastSeenAt ?? undefined,
        expiresAt: estate.expiresAt ?? undefined,
        overdue: this.service.isOverdue(estate),
        publicIp: estate.publicIp ?? undefined,
        provider: estate.provider ?? undefined,
        providerServerType: estate.providerServerType ?? undefined,
        cpuPercent: estate.cpuPercent ?? undefined,
        memoryPercent: estate.memoryPercent ?? undefined,
        ...(home
          ? {
              home: {
                id: home.id,
                title: home.title,
                ...(home.slug ? { slug: home.slug } : {}),
              },
            }
          : {}),
        isHome: estate.projectId === projectId,
        can: estate.projectId == null ? [] : (can.get(estate.projectId) ?? []),
        lentAt,
      };
    });
  }
}
