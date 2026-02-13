import { $inject, t } from "alepha";
import { $secure } from "alepha/security";
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
}
