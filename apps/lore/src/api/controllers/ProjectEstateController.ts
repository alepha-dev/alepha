import { $inject, type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  okSchema,
} from "alepha/server";

import { displayName } from "../../web/app/services/displayName.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { projects } from "../entities/projects.ts";
import { estateSlugSchema } from "../schemas/estateSlugSchema.ts";
import {
  type LentEstateResource,
  lentEstateResourceSchema,
  type MintedLentEstate,
  mintedLentEstateSchema,
} from "../schemas/lentEstateResourceSchema.ts";
import { EstateService } from "../services/EstateService.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export type { LentEstateResource, MintedLentEstate };

type UserRow = Infer<typeof users.schema>;

/**
 * The lending, from the project's side: which estates this project may
 * deploy through, and who may change that.
 *
 * ## The trust statement this controller enforces
 *
 * Attaching is a grant, and a bigger one than it looks: whoever can deploy in
 * the project can then run code inside the estate owner's account, with that
 * account's storage and secrets bound to it. So attaching needs both hats on
 * one caller: `assertOwner` on the project (it changes what the project can
 * deploy to) and `loadOwned` on the estate (it exposes the owner's account).
 * A plain member with an estate of their own cannot lend it into a project
 * they do not own; widening that is one line in `attachEstate`, and folio
 * #1198 records the owner's decision to start narrow.
 *
 * Detaching takes either owner: the project owner is giving up a capability,
 * the estate owner is withdrawing a loan. Both are legitimate and neither
 * undeploys anything.
 *
 * ## What a member may learn
 *
 * A member sees THAT the project holds an estate called `ovh-1`, who owns it,
 * and whether the machine is up. They cannot enumerate the owner's other
 * estates, or discover estates lent to projects they are not in: the only
 * list here is per project and member-gated, and the "add existing" picker
 * is the caller's own list (`EstateController.listMyEstates`), never anyone
 * else's.
 */
export class ProjectEstateController {
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly projects = $repository(projects);
  protected readonly users = $repository(users);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly service = $inject(EstateService);
  protected readonly audits = $inject(LoreAudits);

  /**
   * Every estate lent to this project, newest loan first. Member-readable,
   * because "where can this project deploy" is a question every member may
   * ask, and nothing in the answer belongs to the owner alone.
   */
  listProjectEstates = $action({
    use: [$secure({ permissions: ["project:read"] })],
    method: "GET",
    path: "/projects/:projectId/estates",
    schema: {
      params: z.object({ projectId: z.integer() }),
      response: z.object({ items: z.array(lentEstateResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);
      return { items: await this.lentTo(params.projectId) };
    },
  });

  /**
   * Lend one of the caller's own estates to this project.
   */
  attachEstate = $action({
    use: [$secure({ permissions: ["estate:lend"] })],
    method: "POST",
    path: "/projects/:projectId/estates",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({ estateId: z.uuid() }),
      response: lentEstateResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.projectId, user);
      // 404 for an estate the caller does not own, like every other read of
      // somebody else's estate: the id alone must not confirm it exists.
      const estate = await this.service.loadOwned(body.estateId, user);
      return this.lend(params.projectId, estate, user);
    },
  });

  /**
   * Mint a new estate and lend it in one step, without leaving the project.
   * Same creation path as the account page, so the two cannot disagree, and
   * the secret is handed back exactly once.
   */
  createProjectEstate = $action({
    use: [$secure({ permissions: ["estate:lend"] })],
    method: "POST",
    path: "/projects/:projectId/estates/new",
    schema: {
      params: z.object({ projectId: z.integer() }),
      body: z.object({
        slug: estateSlugSchema,
        label: z.string().max(100).optional(),
      }),
      response: mintedLentEstateSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.projectId, user);
      const { estate, secret } = await this.service.createBay(user, body);
      return { ...(await this.lend(params.projectId, estate, user)), secret };
    },
  });

  /**
   * Withdraw the loan. Refused while an environment in this project points
   * at the estate (`assertUnreferenced`, a seam until epic #1's #1810), so
   * nothing silently stops being deployable.
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
      const [project, estate] = await Promise.all([
        this.projects.getOne({ where: { id: { eq: params.projectId } } }),
        this.estates.getOne({ where: { id: { eq: params.estateId } } }),
      ]);
      const projectOwner = project.createdBy === user.id;
      const estateOwner = estate.ownerUserId === user.id;
      if (!projectOwner && !estateOwner) {
        throw new ForbiddenError(
          "Only the project owner or the estate owner can detach an estate",
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
    user: { id: string; email?: string; realm?: string },
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

    const owner = await this.users.findOne({
      where: { id: { eq: estate.ownerUserId } },
    });
    return this.toLent(estate, String(grant.createdAt), owner);
  }

  protected async lentTo(projectId: number): Promise<LentEstateResource[]> {
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
    const owners = await this.users.findMany({
      where: {
        id: { inArray: [...new Set(rows.map((row) => row.ownerUserId))] },
      },
    });
    return grants.flatMap((grant) => {
      const estate = rows.find((row) => row.id === grant.estateId);
      if (!estate) {
        return [];
      }
      return [
        this.toLent(
          estate,
          String(grant.createdAt),
          owners.find((owner) => owner.id === estate.ownerUserId),
        ),
      ];
    });
  }

  /**
   * What a member may see of an estate: built field by field, so a column
   * added to `estates` has to be a decision to show it here.
   */
  protected toLent(
    estate: Estate,
    lentAt: string,
    owner: UserRow | undefined,
  ): LentEstateResource {
    return {
      id: estate.id,
      slug: estate.slug,
      label: estate.label ?? undefined,
      type: estate.type,
      online: this.service.isOnline(estate),
      deployAllowed: estate.deployAllowed,
      acceptedRuntimes: this.service.acceptedRuntimes(estate.type),
      lastSeenAt: estate.lastSeenAt ?? undefined,
      cpuPercent: estate.cpuPercent ?? undefined,
      memoryPercent: estate.memoryPercent ?? undefined,
      owner: { id: estate.ownerUserId, name: displayName(owner, "Unknown") },
      lentAt,
    };
  }
}
