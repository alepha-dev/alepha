import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { $repository, db, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";

import { displayName } from "../../web/app/services/displayName.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { estates } from "../entities/estates.ts";
import { adminEstateResourceSchema } from "../schemas/adminEstateResourceSchema.ts";
import { EstateService } from "../services/EstateService.ts";
import { LoreAudits } from "../services/LoreAudits.ts";

/**
 * Instance-wide view of every estate, for the admin shell (#1838).
 *
 * Every estate endpoint in the application is scoped to its owner, which is
 * correct for the application and useless for the one case this exists for:
 * an estate whose owner is gone or unresponsive, still enrolled, still
 * accepting a socket. An admin can see every estate and delete one, and that
 * is the whole surface. There is no admin attach, rotate or switch here,
 * and no read of a credential: the masking rule has no exception for the
 * admin role.
 *
 * Gated on `admin:estate:read` and `admin:estate:delete`, the
 * `admin:<thing>:<verb>` shape `AdminProjectController` uses.
 */
export class AdminEstateController {
  protected readonly url = "/admin/estates";
  protected readonly group = "admin:estates";
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly users = $repository(users);
  protected readonly service = $inject(EstateService);
  protected readonly audits = $inject(LoreAudits);

  public readonly findEstates = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:estate:read"] })],
    description: "List every estate on this instance, newest first",
    schema: {
      query: pageQuerySchema.extend({
        search: z.string().optional(),
      }),
      response: db.page(adminEstateResourceSchema),
    },
    handler: async ({ query }) => {
      const where = this.estates.createQueryWhere();
      if (query.search) {
        where.slug = { ilike: `%${query.search}%` };
      }
      query.sort ??= "-createdAt";

      const result = await this.estates.paginate(
        query,
        { where },
        { count: true },
      );

      // Two extra queries for the whole page, never two per row.
      const ids = result.content.map((estate) => estate.id);
      const ownerIds = [
        ...new Set(result.content.map((estate) => estate.ownerUserId)),
      ];
      const [grants, owners] = await Promise.all([
        ids.length
          ? this.grants.findMany({
              where: { estateId: { inArray: ids } },
              columns: ["estateId"],
            })
          : [],
        ownerIds.length
          ? this.users.findMany({ where: { id: { inArray: ownerIds } } })
          : [],
      ]);

      const projectCounts = new Map<string, number>();
      for (const grant of grants) {
        projectCounts.set(
          grant.estateId,
          (projectCounts.get(grant.estateId) ?? 0) + 1,
        );
      }
      const names = new Map(
        owners.map((owner) => [owner.id, displayName(owner)]),
      );

      return {
        ...result,
        content: result.content.map((estate) => ({
          id: estate.id,
          slug: estate.slug,
          label: estate.label,
          type: estate.type,
          secretPrefix: estate.secretPrefix,
          accountId: estate.accountId,
          ownerUserId: estate.ownerUserId,
          ownerName: names.get(estate.ownerUserId),
          online: this.service.isOnline(estate),
          deployAllowed: estate.deployAllowed,
          lastSeenAt: estate.lastSeenAt,
          createdAt: String(estate.createdAt),
          projectCount: projectCounts.get(estate.id) ?? 0,
        })),
      };
    },
  });

  /**
   * Delete one estate, owner or no owner.
   *
   * Same rules as the owner's own delete: refused while an environment
   * points at it, revokes a `bay` secret by removing the row that IS the
   * credential, undeploys nothing. The audit row is the owner's shape with a
   * different actor, so the two read alike in the log.
   */
  public readonly adminDeleteEstate = $action({
    path: `${this.url}/:id`,
    method: "DELETE",
    group: this.group,
    use: [$secure({ permissions: ["admin:estate:delete"] })],
    description: "Delete an estate, revoking its secret",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const estate = await this.estates.findOne({
        where: { id: { eq: params.id } },
      });
      if (!estate) {
        throw new NotFoundError("Estate not found");
      }
      await this.service.assertUnreferenced(estate.id);
      await this.estates.deleteById(estate.id);

      await this.audits.estate.logSuccess("delete", {
        ...this.audits.actor(user),
        severity: "warning",
        resourceType: "estate",
        resourceId: estate.id,
        description: estate.slug,
        metadata: { admin: true, ownerUserId: estate.ownerUserId },
      });

      return { ok: true };
    },
  });
}
