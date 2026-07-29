import { createMiddleware, type Middleware } from "alepha";
import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import type { SecureOptions } from "./$secure.ts";

export type { SecureOptions };

/**
 * Browser-side middleware that enforces authentication and authorization.
 *
 * Resolves the user from `currentUserAtom` only (no HTTP header resolution).
 * Checks issuers and roles from the user object; permission checks are left
 * to the server, which enforces them on the real request.
 *
 * In the browser, an unauthenticated or unauthorized user is not an exception —
 * the middleware short-circuits by returning `undefined` and the handler is not called.
 * Components should use `can()` on `$client` virtual actions to conditionally
 * render UI elements.
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

        // Custom guard.
        //
        // The browser has no server request, so `params` / `query` / `body`
        // are empty here. A guard that reads them denies in the browser and is
        // re-evaluated for real on the server — which is the safe direction:
        // the UI hides the action, the API is what actually enforces it.
        if (options?.guard) {
          const allowed = await options.guard({
            user,
            params: {},
            query: {},
            body: undefined,
            alepha,
          });

          if (!allowed) {
            return undefined;
          }
        }

        return next(...args);
      };
    },
  });
}
