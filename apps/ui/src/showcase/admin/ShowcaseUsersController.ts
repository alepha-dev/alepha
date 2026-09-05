import { $inject, z } from "alepha";
import { userQuerySchema, userResourceSchema } from "alepha/api/users";
import { $action } from "alepha/server";

import { ShowcaseUsers } from "./ShowcaseUsers.ts";

/**
 * Stands in for `AdminUserController` so `<AdminUsers />` renders real rows.
 *
 * ⚠️ Property names ARE action names and must match the real controller
 * exactly: the virtual client is a flat proxy, so `client.findUsers(...)`
 * dispatches whatever is named `findUsers` and nothing else.
 *
 * The mutating actions accept and change nothing. This site is one shared
 * read-only reference, so a real disable or delete would let any visitor
 * degrade the page for everyone after them. They answer in the right shape,
 * which is enough for the component to toast and refetch.
 */
export class ShowcaseUsersController {
  protected readonly users = $inject(ShowcaseUsers);

  public readonly findUsers = $action({
    path: "/admin/users",
    schema: {
      query: userQuerySchema.extend({
        userRealmName: z.string().optional(),
      }),
      response: z.page(userResourceSchema),
    },
    handler: ({ query }) => this.users.paginate(query as any),
  });

  /**
   * Needed by `AdminUserDetail`, which the users table links to. Without it
   * that page renders a permanent skeleton, and the row click looks broken.
   */
  public readonly getUser = $action({
    path: "/admin/users/:id",
    schema: {
      params: z.object({ id: z.text() }),
      query: z.object({ userRealmName: z.string().optional() }),
      response: userResourceSchema,
    },
    handler: ({ params }) =>
      (this.users.rows().find((u) => u.id === params.id) ??
        this.users.rows()[0]) as any,
  });

  public readonly findRoles = $action({
    path: "/admin/users/metadata/roles",
    schema: {
      query: z.object({ userRealmName: z.string().optional() }),
      response: z.array(
        z.object({
          name: z.string(),
          default: z.boolean().optional(),
          description: z.string().optional(),
        }),
      ),
    },
    handler: () => this.users.roles(),
  });

  public readonly updateUser = $action({
    method: "PATCH",
    path: "/admin/users/:id",
    schema: {
      params: z.object({ id: z.text() }),
      query: z.object({ userRealmName: z.string().optional() }),
      body: z.record(z.text(), z.any()),
      response: userResourceSchema,
    },
    // Echoes the stored row rather than the patch: the component re-renders
    // from what comes back, and inventing a merged row here would show a
    // change the next refetch silently undoes.
    handler: ({ params }) =>
      (this.users.rows().find((u) => u.id === params.id) ??
        this.users.rows()[0]) as any,
  });

  public readonly deleteUser = $action({
    method: "DELETE",
    path: "/admin/users/:id",
    schema: {
      params: z.object({ id: z.text() }),
      query: z.object({ userRealmName: z.string().optional() }),
      response: z.object({ deleted: z.boolean() }),
    },
    handler: () => ({ deleted: true }),
  });

  public readonly deleteUsers = $action({
    method: "DELETE",
    path: "/admin/users",
    schema: {
      query: z.object({ userRealmName: z.string().optional() }),
      body: z.object({ ids: z.array(z.text()) }),
      response: z.object({ deleted: z.integer() }),
    },
    handler: ({ body }) => ({ deleted: body.ids.length }),
  });
}
