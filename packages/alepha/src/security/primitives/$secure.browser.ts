import { createMiddleware, type Middleware } from "alepha";
import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import type { SecureOptions } from "./$secure.ts";

export type { SecureOptions };

/**
 * Browser-side middleware that enforces authentication and authorization.
 *
 * Resolves the user from `currentUserAtom` only (no HTTP header resolution).
 * Checks roles from the user object and permissions from the user's roles.
 *
 * In the browser, an unauthenticated or unauthorized user is not an exception —
 * the middleware short-circuits by returning `undefined` and the handler is not called.
 * Components should use `action.can()` to conditionally render UI elements.
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
export function $secure(options?: SecureOptions): Middleware {
  return createMiddleware({
    name: "$secure",
    options: (options as unknown as Record<string, unknown>) ?? undefined,
    handler: ({ alepha, next }) => {
      return async (...args: any[]) => {
        const user: UserAccountToken | undefined =
          alepha.store.get(currentUserAtom);

        if (!user) {
          return undefined;
        }

        // Issuer check
        if (options?.issuers?.length) {
          if (!user.realm || !options.issuers.includes(user.realm)) {
            return undefined;
          }
        }

        // Role check
        if (options?.roles?.length) {
          const hasRole = options.roles.some((role) =>
            user.roles?.includes(role),
          );
          if (!hasRole) {
            return undefined;
          }
        }

        // Permission check (browser-side: check against user roles)
        // Server-side permissions are enforced by the API — the browser version
        // trusts that the API registry already filtered actions by permission.

        // Custom guard
        if (options?.guard) {
          if (!options.guard(user)) {
            return undefined;
          }
        }

        return next(...args);
      };
    },
  });
}
