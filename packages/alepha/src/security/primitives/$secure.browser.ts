import {
  $context,
  createMiddleware,
  MIDDLEWARE_PROTECTED,
  type Middleware,
} from "alepha";
import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { PermissionRegistryProvider } from "../providers/PermissionRegistryProvider.ts";
import type { SecureOptions } from "./$secure.ts";

export type { SecureOptions };

/**
 * Browser-side middleware that enforces authentication and authorization.
 *
 * Resolves the user from `currentUserAtom` only (no HTTP header resolution).
 * Checks issuers and roles from the user object, and permissions against the
 * registry the server sent down (`PermissionRegistryProvider`). The server
 * re-checks all of it on the real request — this side exists so the UI agrees
 * with the answer the server would give, not to enforce anything.
 *
 * In the browser, an unauthenticated or unauthorized user is not an exception —
 * the middleware short-circuits by returning `undefined` and the handler is not called.
 * Components should use `can()` on `$client` virtual actions to conditionally
 * render UI elements.
 *
 * On a `$page`, that short-circuit is what the router's guard-denial path keys
 * on: it tracks whether `next` was called, so a denied visitor is redirected to
 * the `login` route (anonymous) or refused with 403 (authenticated), rather
 * than rendering the page without its data.
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
  // Resolved here, at `$secure()` call time, rather than inside the handler.
  //
  // A middleware handler first runs on the first *call*, which is after
  // `alepha.start()` has locked the container — injecting there throws
  // `ContainerLockedError`.
  //
  // Only when permissions are actually declared: issuer/role/guard checks read
  // the user object alone and need nothing injected.
  const registry = options?.permissions?.length
    ? $context().alepha.inject(PermissionRegistryProvider)
    : undefined;

  return createMiddleware({
    name: "$secure",
    options: (options as unknown as Record<string, unknown>) ?? undefined,
    // Must match the server variant: the router reads this to pick a page's
    // rendering mode, and a page that disagreed across the two bundles would
    // server-render HTML the client then decided not to.
    meta: { [MIDDLEWARE_PROTECTED]: "true" },
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

        // Permission check.
        //
        // Resolved against the permission set the server sent down with the API
        // registry — the same source that backs `useAuth().has` and `$page.can`,
        // so a guard and the UI affordance it gates can never disagree.
        // Wildcards (`admin:*`) are handled by the provider.
        //
        // This used to be skipped entirely on the grounds that the API registry
        // had already filtered actions by permission. That holds for a `$client`
        // virtual action, whose call site *is* the registry lookup — but not for
        // `$secure` wrapping an arbitrary handler such as a `$page` loader,
        // where nothing had filtered anything and the guard silently admitted
        // every authenticated user.
        //
        // Permissions remain an AND list, matching the server.
        if (registry && options?.permissions?.length) {
          const granted = options.permissions.every((permission) =>
            registry.can(
              typeof permission === "string" ? permission : permission.name,
            ),
          );

          if (!granted) {
            return undefined;
          }
        }

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
