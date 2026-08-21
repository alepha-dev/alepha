import { $inject, z } from "alepha";
import { $secure, SecurityProvider } from "alepha/security";
import { $action, okSchema } from "alepha/server";

import { createUserSchema } from "../schemas/createUserSchema.ts";
import { updateUserSchema } from "../schemas/updateUserSchema.ts";
import { userQuerySchema } from "../schemas/userQuerySchema.ts";
import { userResourceSchema } from "../schemas/userResourceSchema.ts";
import { UserService } from "../services/UserService.ts";

export class AdminUserController {
  protected readonly url = "/users";
  protected readonly group = "admin:users";
  protected readonly userService = $inject(UserService);
  protected readonly securityProvider = $inject(SecurityProvider);

  /**
   * List roles available in a realm. Used by the admin UI to render the
   * role picker and grey out defaults (which cannot be removed).
   */
  public readonly findRoles = $action({
    path: "/metadata/roles",
    group: this.group,
    use: [$secure({ permissions: ["admin:user:read"] })],
    description: "List roles available in a realm",
    schema: {
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      response: z.array(
        z.object({
          name: z.string(),
          default: z.boolean().optional(),
          description: z.string().optional(),
        }),
      ),
    },
    handler: ({ query, user }) => {
      const roles = this.securityProvider.getRoles(
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      );
      return roles.map((r) => ({
        name: r.name,
        default: r.default,
        description: r.description,
      }));
    },
  });

  /**
   * Find users with pagination and filtering.
   */
  public readonly findUsers = $action({
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:user:read"] })],
    description: "Find users with pagination and filtering",
    schema: {
      query: userQuerySchema.extend({
        userRealmName: z.string().optional(),
      }),
      response: z.page(userResourceSchema),
    },
    handler: ({ query, user }) => {
      const { userRealmName, ...q } = query;
      return this.userService.findUsers(
        q,
        this.securityProvider.assertRealmScope(user, userRealmName),
      );
    },
  });

  /**
   * Get a user by ID.
   */
  public readonly getUser = $action({
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:user:read"] })],
    description: "Get a user by ID",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      response: userResourceSchema,
    },
    handler: ({ params, query, user }) =>
      this.userService.getUserById(
        params.id,
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      ),
  });

  /**
   * Create a new user.
   */
  public readonly createUser = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    use: [$secure({ permissions: ["admin:user:create"] })],
    description: "Create a new user",
    schema: {
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      body: createUserSchema,
      response: userResourceSchema,
    },
    handler: ({ body, query, user }) =>
      this.userService.createUser(
        body,
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      ),
  });

  /**
   * Update a user.
   */
  public readonly updateUser = $action({
    method: "PATCH",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:user:update"] })],
    description: "Update a user",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      body: updateUserSchema,
      response: userResourceSchema,
    },
    handler: ({ params, body, query, user }) =>
      this.userService.updateUser(
        params.id,
        body,
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      ),
  });

  /**
   * Set (or reset) a user's password. Admin-only flow — does NOT
   * require knowing the previous password. Hash is stored as a
   * "credentials" identity for the user (upsert).
   */
  public readonly setUserPassword = $action({
    method: "POST",
    path: `${this.url}/:id/password`,
    group: this.group,
    use: [$secure({ permissions: ["admin:user:update"] })],
    description: "Set a user's password",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      body: z.object({
        password: z.string().min(1),
      }),
      response: okSchema,
    },
    handler: async ({ params, body, query, user }) => {
      await this.userService.setPassword(
        params.id,
        body.password,
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      );
      return { ok: true, id: params.id };
    },
  });

  /**
   * Delete a user.
   */
  public readonly deleteUser = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    use: [$secure({ permissions: ["admin:user:delete"] })],
    description: "Delete a user",
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      response: okSchema,
    },
    handler: async ({ params, query, user }) => {
      await this.userService.deleteUser(
        params.id,
        this.securityProvider.assertRealmScope(user, query.userRealmName),
      );
      return { ok: true, id: params.id };
    },
  });

  /**
   * Delete many users in one request. Each id is processed sequentially so
   * cascades and side-effects run as if called one-by-one. Errors on a single
   * id surface with that id in the response.
   */
  public readonly deleteUsers = $action({
    method: "POST",
    path: `${this.url}/delete`,
    group: this.group,
    use: [$secure({ permissions: ["admin:user:delete"] })],
    description: "Delete many users",
    schema: {
      query: z.object({
        userRealmName: z.string().optional(),
      }),
      body: z.object({
        ids: z.array(z.uuid()).min(1).max(1000),
      }),
      response: z.object({
        deleted: z.array(z.uuid()),
      }),
    },
    handler: async ({ body, query, user }) => {
      const realm = this.securityProvider.assertRealmScope(
        user,
        query.userRealmName,
      );
      const deleted: string[] = [];
      for (const id of body.ids) {
        await this.userService.deleteUser(id, realm);
        deleted.push(id);
      }
      return { deleted };
    },
  });
}
