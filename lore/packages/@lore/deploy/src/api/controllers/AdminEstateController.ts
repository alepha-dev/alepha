import { LoreAudits } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { displayName } from "@lore/core/web";
import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { $repository, db, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";

import { estateProjects } from "../entities/estateProjects.ts";
import { estates } from "../entities/estates.ts";
import { adminEstateResourceSchema } from "../schemas/adminEstateResourceSchema.ts";
import { EstateCloudflareService } from "../services/EstateCloudflareService.ts";
import { EstateService } from "../services/EstateService.ts";

/**
 * Instance-wide view of every estate, for the admin shell (#1838).
 *
 * Every estate endpoint in the application is gated on its home project's
 * rank (#E126), which is correct for the application and useless for the
 * case this exists for: an estate with no home, which the migration could
 * not place, still enrolled, still accepting a socket. An admin can see
 * every estate, assign one a home, and delete one, and that is the whole
 * surface. There is no admin attach, rotate or switch here, and no read of
 * a credential: the masking rule has no exception for the admin role.
 *
 * Gated on `admin:estate:read`, `admin:estate:update` (assign) and
 * `admin:estate:delete`, the
 * `admin:<thing>:<verb>` shape `AdminProjectController` uses.
 */
export class AdminEstateController {
  protected readonly url = "/admin/estates";
  protected readonly group = "admin:estates";
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly users = $repository(users);
  protected readonly projects = $repository(projects);
  protected readonly service = $inject(EstateService);
  protected readonly cloudflare = $inject(EstateCloudflareService);
  protected readonly audits = $inject(LoreAudits);

  public readonly findEstates = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:estate:read"] })],
    description: "List every estate on this instance, newest first",
    schema: {
      query: pageQuerySchema.extend({
        search: z.string().optional(),
        /**
         * Only the estates with no home project: the ones to assign.
         */
        homeless: z.boolean().optional(),
      }),
      response: db.page(adminEstateResourceSchema),
    },
    handler: async ({ query }) => {
      const where = this.estates.createQueryWhere();
      if (query.search) {
        where.slug = { ilike: `%${query.search}%` };
      }
      if (query.homeless) {
        where.projectId = { isNull: true };
      }
      query.sort ??= "-createdAt";

      const result = await this.estates.paginate(
        query,
        { where },
        { count: true },
      );

      // Three extra queries for the whole page, never per row.
      const ids = result.content.map((estate) => estate.id);
      const creatorIds = [
        ...new Set(
          result.content.flatMap((estate) =>
            estate.createdBy ? [estate.createdBy] : [],
          ),
        ),
      ];
      const [grants, creators] = await Promise.all([
        ids.length
          ? this.grants.findMany({
              where: { estateId: { inArray: ids } },
              columns: ["estateId", "projectId", "createdAt"],
              orderBy: [{ column: "createdAt", direction: "asc" }],
            })
          : [],
        creatorIds.length
          ? this.users.findMany({ where: { id: { inArray: creatorIds } } })
          : [],
      ]);
      const projectIds = [
        ...new Set([
          ...grants.map((grant) => grant.projectId),
          ...result.content.flatMap((estate) =>
            estate.projectId == null ? [] : [estate.projectId],
          ),
        ]),
      ];
      const named = projectIds.length
        ? await this.projects.findMany({
            where: { id: { inArray: projectIds } },
            columns: ["id", "title", "slug"],
          })
        : [];
      const projectOf = (id: number) => {
        const project = named.find((row) => row.id === id);
        return project
          ? {
              id: project.id,
              title: project.title,
              ...(project.slug ? { slug: project.slug } : {}),
            }
          : undefined;
      };
      const names = new Map(
        creators.map((creator) => [creator.id, displayName(creator)]),
      );

      return {
        ...result,
        content: result.content.map((estate) => {
          const home =
            estate.projectId == null ? undefined : projectOf(estate.projectId);
          const creatorName = estate.createdBy
            ? names.get(estate.createdBy)
            : undefined;
          return {
            id: estate.id,
            slug: estate.slug,
            label: estate.label,
            type: estate.type,
            secretPrefix: estate.secretPrefix,
            accountId: estate.accountId,
            ...(home ? { project: home } : {}),
            ...(estate.createdBy && creatorName
              ? { creator: { id: estate.createdBy, name: creatorName } }
              : {}),
            online: this.service.isOnline(estate),
            credentialStatus: this.cloudflare.credentialStatus(estate),
            deployAllowed: estate.deployAllowed,
            lastSeenAt: estate.lastSeenAt,
            createdAt: String(estate.createdAt),
            loans: grants
              .filter((grant) => grant.estateId === estate.id)
              .flatMap((grant) => {
                const project = projectOf(grant.projectId);
                return project ? [project] : [];
              }),
          };
        }),
      };
    },
  });

  /**
   * Assign an estate a home project (#Q3280): for an estate the migration
   * could not place, normally to the project it is lent to, and as a
   * backstop for any estate. Same rules on the target as a move (Apps on, no
   * slug collision, the anchor set to the project's owner), and the loans
   * are untouched. Still no credential crosses: the answer is the new home
   * and the loans.
   */
  public readonly assignEstate = $action({
    path: `${this.url}/:id/assign`,
    method: "POST",
    group: this.group,
    use: [$secure({ permissions: ["admin:estate:update"] })],
    description: "Give an estate a home project, its loans untouched",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ projectId: z.integer() }),
      response: z.object({
        project: z.object({
          id: z.integer(),
          title: z.string(),
          slug: z.string().optional(),
        }),
        loans: z.array(
          z.object({
            id: z.integer(),
            title: z.string(),
            slug: z.string().optional(),
          }),
        ),
      }),
    },
    handler: async ({ params, body, user }) => {
      const estate = await this.estates.findById(params.id);
      if (!estate) {
        throw new NotFoundError("Estate not found");
      }
      const { from } = await this.service.rehome(estate, body.projectId);
      for (const projectId of [from, body.projectId]) {
        if (projectId === undefined) continue;
        await this.audits.estate.logSuccess("assign", {
          ...this.audits.actor(user),
          ...this.audits.scope(projectId),
          severity: "warning",
          resourceType: "estate",
          resourceId: estate.id,
          description: estate.slug,
          metadata: { admin: true, from: from ?? null, to: body.projectId },
        });
      }
      const project = await this.projects.getById(body.projectId);
      return {
        project: {
          id: project.id,
          title: project.title,
          ...(project.slug ? { slug: project.slug } : {}),
        },
        loans: await this.service.loansOf(estate.id),
      };
    },
  });

  /**
   * Delete one estate, owner or no owner.
   *
   * Same rules as the console's own delete: refused while an environment
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
        metadata: { admin: true, projectId: estate.projectId ?? null },
      });

      return { ok: true };
    },
  });
}
