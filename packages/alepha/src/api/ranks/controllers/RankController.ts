import { $inject, z } from "alepha";
import { $secure, SecurityProvider } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { RankResourceProvider } from "../providers/RankResourceProvider.ts";
import { rankResourceSchema } from "../schemas/rankResourceSchema.ts";
import { RankService } from "../services/RankService.ts";

/**
 * The module's own HTTP surface, so an application gets a rank editor without
 * writing a controller.
 *
 * The same arrangement `alepha/api/invitations` uses for
 * `AdminInvitationController`: the module ships the endpoints, and the
 * application's `$rankResource` decides who may call them through
 * `assertCanManage` / `assertCanAssign`. There is no permission string here
 * for the application to match, because who may edit ranks is a fact about
 * the scope and not about this module.
 *
 * ⚠️ **`$secure()` and nothing more.** Authentication is this module's to
 * require; authorization is the resource's, and putting a permission on the
 * action as well would mean two places to keep in step for the same question.
 */
export class RankController {
  protected readonly ranks = $inject(RankService);
  protected readonly resources = $inject(RankResourceProvider);
  protected readonly security = $inject(SecurityProvider);

  /**
   * The catalogue a rank editor renders its columns from: every permission
   * the application declares, grouped and ordered.
   *
   * Read straight out of the permission registry, which is the same list the
   * write path validates against - so a matrix cannot offer a permission a
   * rank would then be refused.
   */
  getRankCatalogue = $action({
    use: [$secure()],
    method: "GET",
    path: "/ranks/catalogue",
    schema: {
      response: z.object({
        groups: z.array(
          z.object({
            name: z.text(),
            label: z.text().optional(),
            order: z.integer().optional(),
            permissions: z.array(
              z.object({
                name: z.text(),
                label: z.text().optional(),
                description: z.text().optional(),
              }),
            ),
          }),
        ),
      }),
    },
    handler: async () => ({
      groups: this.security.permissionCatalogue().map((group) => ({
        name: group.name,
        ...(group.label === undefined ? {} : { label: group.label }),
        ...(group.order === undefined ? {} : { order: group.order }),
        permissions: group.permissions.map((permission) => ({
          // ⚠️ The FULL `group:name`, not the registry's bare `name`.
          // This is the string a rank definition stores and the string the
          // write path validates, so a matrix built from a bare `read` sends
          // back a permission nothing recognises - and every cell in it reads
          // as one nobody may grant, which is what it looked like the first
          // time this shipped.
          name: permission.group
            ? `${permission.group}:${permission.name}`
            : permission.name,
          ...(permission.label === undefined
            ? {}
            : { label: permission.label }),
          ...(permission.description === undefined
            ? {}
            : { description: permission.description }),
        })),
      })),
    }),
  });

  /**
   * Every rank a scope has: the declared built-ins, plus whatever it has
   * customised or created.
   */
  getRanks = $action({
    use: [$secure()],
    method: "GET",
    path: "/ranks/:type/:scopeId",
    schema: {
      params: z.object({ type: z.text(), scopeId: z.text() }),
      response: z.object({ items: z.array(rankResourceSchema) }),
    },
    handler: async ({ params, user }) => {
      const resource = this.resources.get(params.type);
      // Reading the ranks of a scope is managing it: the set of permissions a
      // scope hands out is not something a passer-by needs.
      await resource.options.assertCanManage?.(params.scopeId, user);
      return { items: await this.ranks.ranksOf(params.type, params.scopeId) };
    },
  });

  /**
   * Create a rank, or rewrite one that already exists.
   *
   * One action rather than a create/update pair: the key is supplied by the
   * caller and is what identifies a rank, so "create" and "rewrite" are the
   * same statement with the same invariants, and splitting them would give
   * the invariants two homes.
   */
  saveRank = $action({
    use: [$secure()],
    method: "PUT",
    path: "/ranks/:type/:scopeId/:key",
    schema: {
      params: z.object({
        type: z.text(),
        scopeId: z.text(),
        key: z.text({ minLength: 1, maxLength: 64 }),
      }),
      body: z.object({
        name: z.text({ minLength: 1, maxLength: 100 }),
        permissions: z.array(z.text()),
      }),
      response: rankResourceSchema,
    },
    handler: async ({ params, body, user }) =>
      await this.ranks.save(
        params.type,
        params.scopeId,
        { key: params.key, name: body.name, permissions: body.permissions },
        user,
      ),
  });

  deleteRank = $action({
    use: [$secure()],
    method: "DELETE",
    path: "/ranks/:type/:scopeId/:key",
    schema: {
      params: z.object({
        type: z.text(),
        scopeId: z.text(),
        key: z.text(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.ranks.remove(params.type, params.scopeId, params.key, user);
      return { ok: true };
    },
  });

  /**
   * Give somebody a rank.
   *
   * The module does not own the column the assignment lives in, so the
   * resource's `assign` closure performs the write and this performs the
   * checks - including the subset rule, because handing somebody a rank you
   * could not have written is the same escalation by a different door.
   */
  assignRank = $action({
    use: [$secure()],
    method: "PUT",
    path: "/ranks/:type/:scopeId/assignments/:userId",
    schema: {
      params: z.object({
        type: z.text(),
        scopeId: z.text(),
        userId: z.text(),
      }),
      body: z.object({ key: z.text({ minLength: 1, maxLength: 64 }) }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      await this.ranks.assign(
        params.type,
        params.scopeId,
        params.userId,
        body.key,
        user,
      );
      return { ok: true };
    },
  });
}
