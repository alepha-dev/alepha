import { $inject, t } from "alepha";
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
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      response: t.array(
        t.object({
          name: t.string(),
          default: t.optional(t.boolean()),
          description: t.optional(t.string()),
        }),
      ),
    },
    handler: ({ query }) => {
      const roles = this.securityProvider.getRoles(query.userRealmName);
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
      query: t.extend(userQuerySchema, {
        userRealmName: t.optional(t.string()),
      }),
      response: t.page(userResourceSchema),
    },
    handler: ({ query }) => {
      const { userRealmName, ...q } = query;
      return this.userService.findUsers(q, userRealmName);
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
      params: t.object({
        id: t.uuid(),
      }),
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      response: userResourceSchema,
    },
    handler: ({ params, query }) =>
      this.userService.getUserById(params.id, query.userRealmName),
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
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      body: createUserSchema,
      response: userResourceSchema,
    },
    handler: ({ body, query }) =>
      this.userService.createUser(body, query.userRealmName),
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
      params: t.object({
        id: t.uuid(),
      }),
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      body: updateUserSchema,
      response: userResourceSchema,
    },
    handler: ({ params, body, query }) =>
      this.userService.updateUser(params.id, body, query.userRealmName),
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
      params: t.object({
        id: t.uuid(),
      }),
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      body: t.object({
        password: t.string({ minLength: 1 }),
      }),
      response: okSchema,
    },
    handler: async ({ params, body, query }) => {
      await this.userService.setPassword(
        params.id,
        body.password,
        query.userRealmName,
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
      params: t.object({
        id: t.uuid(),
      }),
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      response: okSchema,
    },
    handler: async ({ params, query }) => {
      await this.userService.deleteUser(params.id, query.userRealmName);
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
      query: t.object({
        userRealmName: t.optional(t.string()),
      }),
      body: t.object({
        ids: t.array(t.uuid(), { minItems: 1, maxItems: 1000 }),
      }),
      response: t.object({
        deleted: t.array(t.uuid()),
      }),
    },
    handler: async ({ body, query }) => {
      const deleted: string[] = [];
      for (const id of body.ids) {
        await this.userService.deleteUser(id, query.userRealmName);
        deleted.push(id);
      }
      return { deleted };
    },
  });
}
