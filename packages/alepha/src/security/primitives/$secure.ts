import { AlephaError, createMiddleware, type Middleware } from "alepha";
import {
  ForbiddenError,
  type ServerRequest,
  UnauthorizedError,
} from "alepha/server";
import { SecurityProvider } from "../providers/SecurityProvider.ts";
import type { Permission } from "../schemas/permissionSchema.ts";

export interface SecureOptions {
  /**
   * Restrict to a specific authentication realm.
   */
  realm?: string;

  /**
   * Required permissions. All must be satisfied.
   */
  permissions?: (string | Permission)[];
}

/**
 * Middleware that enforces authentication and authorization.
 *
 * Resolves the user from the request's authorization header via `SecurityProvider`.
 * Throws `UnauthorizedError` if no user is resolved, `ForbiddenError` if permissions fail.
 * Sets `request.user` and stores user in ALS for downstream access.
 *
 * **Route middleware** — requires a request context (`$action`). Throws if used outside one.
 *
 * ```typescript
 * class OrderController {
 *   getOrders = $action({
 *     use: [$secure()],
 *     handler: async ({ query }) => { ... },
 *   });
 *
 *   deleteOrder = $action({
 *     use: [$secure({ permissions: ["orders:delete"] })],
 *     handler: async ({ params }) => { ... },
 *   });
 * }
 * ```
 */
export const $secure = (options?: SecureOptions): Middleware => {
  return createMiddleware({
    name: "$secure",
    options: options as unknown as Record<string, unknown>,
    handler: ({ alepha, next }) => {
      const securityProvider = alepha.inject(SecurityProvider);

      return async (...args) => {
        const request = alepha.context.get<ServerRequest>("request");

        if (!request) {
          throw new AlephaError(
            "$secure requires a request context (use inside $action)",
          );
        }

        const user = await securityProvider.resolveUserFromServerRequest(
          request,
          {
            realm: options?.realm,
          },
        );

        if (!user) {
          throw new UnauthorizedError("Authentication required");
        }

        if (options?.permissions) {
          for (const perm of options.permissions) {
            const result = securityProvider.checkPermission(
              perm,
              ...(user.roles ?? []),
            );
            if (!result.isAuthorized) {
              throw new ForbiddenError(
                `Permission '${typeof perm === "string" ? perm : perm.name}' required`,
              );
            }
          }
        }

        request.user = user;

        return next(...args);
      };
    },
  });
};
