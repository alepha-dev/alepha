import { HostTypeRegistry, LoreAudits, HostService } from "@lore/core/api";
import {
  projects,
  hostProjects,
  HOST_TYPES,
  hosts,
  adminHostResourceSchema,
  hostSlugSchema,
} from "@lore/core/schemas";
import { displayName } from "@lore/core/web";
import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { $repository, db, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ConflictError, NotFoundError, okSchema } from "alepha/server";

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
  protected readonly types = $inject(HostTypeRegistry);
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
        type: z.enum(HOST_TYPES).optional(),
        /**
         * Derived, like the row's `online`: connected after the last
         * disconnect, and heard from within twice its stats interval.
         */
        state: z.enum(["online", "offline"]).optional(),
        /**
         * Cloudflare only, like the row's `credentialStatus`: a bay host
         * has none, so it never matches either value.
         */
        credentialStatus: z.enum(["valid", "invalid"]).optional(),
      }),
      response: db.page(adminHostResourceSchema),
    },
    handler: async ({ query }) => {
      const where = this.hosts.createQueryWhere();
      if (query.search) {
        where.slug = { ilike: `%${query.search}%` };
      }
      if (query.type) {
        where.type = { eq: query.type };
      }
      if (query.state || query.credentialStatus) {
        // Both are derived from timestamps against now and a per-row
        // interval, so no column holds them. The hosts of an instance are
        // few: read the candidates the other filters leave, keep the ids
        // that match, and page over those, so paging and the count stay
        // exact (#Q3800).
        const candidates = await this.hosts.findMany({ where });
        const ids = candidates
          .filter(
            (host) =>
              (!query.state ||
                this.service.isOnline(host) === (query.state === "online")) &&
              (!query.credentialStatus ||
                this.types.credentialStatus(host) === query.credentialStatus),
          )
          .map((host) => host.id);
        // `inArray: []` throws: an id is never null, so this matches nothing
        // and the page comes back empty with its count.
        where.id = ids.length ? { inArray: ids } : { isNull: true };
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
          ...result.content.map((host) => host.projectId),
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
          const home = projectOf(host.projectId);
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
            credentialStatus: this.types.credentialStatus(host),
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
   * Rename one host, slug and display name, as moderation (#Q3664): an
   * instance admin can fix an offensive or misleading name without deleting
   * the host.
   *
   * ⚠️ The owner's `updateHost` never writes the slug, because a config may
   * record it; this is the deliberate exception, for the admin only, and its
   * audit row records both names so a broken reference can be traced. The
   * slug is normalised and must be free in the host's home project, as at
   * creation; a host with no home is checked against its owner's other
   * homeless hosts. The secret, the loans and the machine are untouched.
   */
  public readonly adminRenameHost = $action({
    path: `${this.url}/:id/rename`,
    method: "POST",
    group: this.group,
    use: [$secure({ permissions: ["admin:host:update"] })],
    description: "Rename a host, slug and display name, as moderation",
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        slug: hostSlugSchema,
        /**
         * The display name. Omitted leaves it; empty clears it.
         */
        label: z.string().max(100).optional(),
      }),
      response: z.object({
        slug: z.string(),
        label: z.string().optional(),
      }),
    },
    handler: async ({ params, body, user }) => {
      const host = await this.hosts.findById(params.id);
      if (!host) {
        throw new NotFoundError("Host not found");
      }

      let slug = this.service.normalizeSlug(body.slug);
      if (slug !== host.slug) {
        if (host.projectId !== undefined) {
          slug = await this.service.claimSlug(host.projectId, slug);
        } else {
          const clash = await this.hosts.findOne({
            where: {
              projectId: { isNull: true },
              ownerUserId: { eq: host.ownerUserId },
              slug: { eq: slug },
            },
          });
          if (clash) {
            throw new ConflictError(
              `This host's owner already has a host named "${slug}"`,
            );
          }
        }
      }
      const label =
        body.label === undefined ? host.label : body.label.trim() || undefined;

      await this.hosts.updateById(host.id, { slug, label: label ?? null });

      await this.audits.host.logSuccess("rename", {
        ...this.audits.actor(user),
        ...(host.projectId === undefined
          ? {}
          : this.audits.scope(host.projectId)),
        severity: "warning",
        resourceType: "host",
        resourceId: host.id,
        description: slug,
        metadata: {
          admin: true,
          from: { slug: host.slug, label: host.label ?? null },
          to: { slug, label: label ?? null },
        },
      });

      return { slug, ...(label ? { label } : {}) };
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
