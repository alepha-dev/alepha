import { LoreAudits } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { displayName } from "@lore/core/web";
import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { $repository, db, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, NotFoundError, okSchema } from "alepha/server";

import { hostProjects } from "../entities/hostProjects.ts";
import { hosts } from "../entities/hosts.ts";
import { adminHostResourceSchema } from "../schemas/adminHostResourceSchema.ts";
import { HostCloudflareService } from "../services/HostCloudflareService.ts";
import { HostService } from "../services/HostService.ts";

/**
 * Instance-wide view of every host, for the admin shell (#1838).
 *
 * Every host endpoint in the application is gated on its home project's
 * rank (#E126), which is correct for the application and useless for the
 * case this exists for: a host with no home, which the migration could
 * not place, still enrolled, still accepting a socket. An admin can see
 * every host, assign one a home, and delete one, and that is the whole
 * surface. There is no admin attach, rotate or switch here, and no read of
 * a credential: the masking rule has no exception for the admin role.
 *
 * Gated on `admin:host:read`, `admin:host:update` (assign) and
 * `admin:host:delete`, the
 * `admin:<thing>:<verb>` shape `AdminProjectController` uses.
 */
export class AdminHostController {
  protected readonly url = "/admin/hosts";
  protected readonly group = "admin:hosts";
  protected readonly hosts = $repository(hosts);
  protected readonly grants = $repository(hostProjects);
  protected readonly users = $repository(users);
  protected readonly projects = $repository(projects);
  protected readonly service = $inject(HostService);
  protected readonly cloudflare = $inject(HostCloudflareService);
  protected readonly audits = $inject(LoreAudits);

  public readonly findHosts = $action({
    method: "GET",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:host:read"] })],
    description: "List every host on this instance, newest first",
    schema: {
      query: pageQuerySchema.extend({
        search: z.string().optional(),
        /**
         * Only the hosts with no home project: the ones to assign.
         */
        homeless: z.boolean().optional(),
      }),
      response: db.page(adminHostResourceSchema),
    },
    handler: async ({ query }) => {
      const where = this.hosts.createQueryWhere();
      if (query.search) {
        where.slug = { ilike: `%${query.search}%` };
      }
      if (query.homeless) {
        where.projectId = { isNull: true };
      }
      query.sort ??= "-createdAt";

      const result = await this.hosts.paginate(
        query,
        { where },
        { count: true },
      );

      // Three extra queries for the whole page, never per row.
      const ids = result.content.map((host) => host.id);
      const creatorIds = [
        ...new Set(
          result.content.flatMap((host) =>
            host.createdBy ? [host.createdBy] : [],
          ),
        ),
      ];
      const [grants, creators] = await Promise.all([
        ids.length
          ? this.grants.findMany({
              where: { hostId: { inArray: ids } },
              columns: ["hostId", "projectId", "createdAt"],
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
          ...result.content.flatMap((host) =>
            host.projectId == null ? [] : [host.projectId],
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
        content: result.content.map((host) => {
          const home =
            host.projectId == null ? undefined : projectOf(host.projectId);
          const creatorName = host.createdBy
            ? names.get(host.createdBy)
            : undefined;
          return {
            id: host.id,
            slug: host.slug,
            label: host.label,
            type: host.type,
            secretPrefix: host.secretPrefix,
            accountId: host.accountId,
            ...(home ? { project: home } : {}),
            ...(host.createdBy && creatorName
              ? { creator: { id: host.createdBy, name: creatorName } }
              : {}),
            online: this.service.isOnline(host),
            credentialStatus: this.cloudflare.credentialStatus(host),
            deployAllowed: host.deployAllowed,
            lastSeenAt: host.lastSeenAt,
            createdAt: String(host.createdAt),
            loans: grants
              .filter((grant) => grant.hostId === host.id)
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
   * Assign a host a home project (#Q3280): for a host the migration
   * could not place, normally to the project it is lent to, and as a
   * backstop for any host. Same rules on the target as a move (Apps on, no
   * slug collision, the anchor set to the project's owner), and the loans
   * are untouched. Still no credential crosses: the answer is the new home
   * and the loans.
   */
  public readonly assignHost = $action({
    path: `${this.url}/:id/assign`,
    method: "POST",
    group: this.group,
    use: [$secure({ permissions: ["admin:host:update"] })],
    description: "Give a host a home project, its loans untouched",
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
      const host = await this.hosts.findById(params.id);
      if (!host) {
        throw new NotFoundError("Host not found");
      }
      const { from } = await this.service.rehome(host, body.projectId);
      for (const projectId of [from, body.projectId]) {
        if (projectId === undefined) continue;
        await this.audits.host.logSuccess("assign", {
          ...this.audits.actor(user),
          ...this.audits.scope(projectId),
          severity: "warning",
          resourceType: "host",
          resourceId: host.id,
          description: host.slug,
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
        loans: await this.service.loansOf(host.id),
      };
    },
  });

  /**
   * Delete one host, owner or no owner.
   *
   * Same rules as the console's own delete: refused while an environment
   * points at it, revokes a `bay` secret by removing the row that IS the
   * credential, undeploys nothing. The audit row is the owner's shape with a
   * different actor, so the two read alike in the log.
   */
  public readonly adminDeleteHost = $action({
    path: `${this.url}/:id`,
    method: "DELETE",
    group: this.group,
    use: [$secure({ permissions: ["admin:host:delete"] })],
    description: "Delete a host, revoking its secret",
    schema: {
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const host = await this.hosts.findOne({
        where: { id: { eq: params.id } },
      });
      if (!host) {
        throw new NotFoundError("Host not found");
      }
      await this.service.assertUnreferenced(host.id);
      await this.hosts.deleteById(host.id);

      await this.audits.host.logSuccess("delete", {
        ...this.audits.actor(user),
        severity: "warning",
        resourceType: "host",
        resourceId: host.id,
        description: host.slug,
        metadata: { admin: true, projectId: host.projectId ?? null },
      });

      return { ok: true };
    },
  });
}
