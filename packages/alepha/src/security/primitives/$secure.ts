import {
  $context,
  type Alepha,
  type Async,
  createMiddleware,
  type Middleware,
} from "alepha";
import {
  ForbiddenError,
  type ServerRequest,
  UnauthorizedError,
} from "alepha/server";
import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { SecurityProvider } from "../providers/SecurityProvider.ts";
import type { Permission } from "../schemas/permissionSchema.ts";

export interface SecureOptions {
  /**
   * Restrict to specific issuers (realms).
   * User must belong to one of the listed issuers.
   */
  issuers?: string[];

  /**
   * Required roles. User must have at least one of the listed roles.
   */
  roles?: string[];

  /**
   * Required permissions. All must be satisfied.
   */
  permissions?: (string | Permission)[];

  /**
   * Custom guard. Runs after all other checks, and is the only check that can
   * see the request — use it for resource-scoped rules such as "does this
   * user own the row named by `params.id`?". Return `false` to deny.
   *
   * May be async. Prefer {@link $owns} for the common owner/membership shape;
   * reach for a raw guard when the rule does not fit that mould.
   */
  guard?: (context: SecureGuardContext) => Async<boolean>;
}

/**
 * Everything a guard can see.
 *
 * `params` / `query` / `body` are resolved from the action request when there
 * is one, falling back to the raw HTTP request — so the same guard works over
 * HTTP, over `action.run()`, and over the MCP transport.
 */
export interface SecureGuardContext {
  /**
   * The authenticated caller, after issuer/role/permission checks have passed.
   */
  user: UserAccountToken;

  /**
   * Route parameters, e.g. `{ id: "42" }` for `/campaigns/:id`. Empty when the
   * host primitive has no request (a bare `$pipeline`, for instance).
   */
  params: Record<string, string>;

  /**
   * Parsed query string.
   */
  query: Record<string, unknown>;

  /**
   * Parsed request body, when the host primitive has one.
   */
  body: unknown;

  /**
   * The underlying HTTP request, when the call arrived over HTTP.
   */
  request?: ServerRequest;

  /**
   * The container, for guards that need to resolve a service.
   */
  alepha: Alepha;
}

/**
 * Middleware that enforces authentication and authorization.
 *
 * Resolves the user from the request context, `currentUserAtom`, or authorization headers.
 * Throws `UnauthorizedError` if no user is resolved, `ForbiddenError` if checks fail.
 * Stores the resolved user in `currentUserAtom` and `request.user` for downstream access.
 *
 * Works across all transports (atom-first resolution):
 * 1. `currentUserAtom` — set by `action.run()` fork, MCP transport, pipelines, jobs
 * 2. `request.user` — set by previous middleware
 * 3. HTTP headers — JWT/API key resolution
 *
 * ## Check Order
 *
 * When multiple options are provided, they are checked in this fixed order.
 * All provided options must pass (AND). Each option has its own logic:
 *
 * 1. **Authentication** — Is there a valid user? → `UnauthorizedError` (401)
 * 2. **Issuers** (OR) — Does the user's realm match at least one? → `ForbiddenError` (403)
 * 3. **Roles** (OR) — Does the user have at least one of the listed roles? → `ForbiddenError` (403)
 * 4. **Permissions** (AND) — Does the user's role grant all listed permissions? → `ForbiddenError` (403)
 * 5. **Guard** — Does the custom function return `true`? → `ForbiddenError` (403)
 *
 * Permissions declared in `$secure()` are auto-created in the permission registry at definition time.
 *
 * Because `permissions` is an AND list, the resulting `ownership` is the most
 * restrictive of the matched grants — one owner-scoped permission narrows the
 * whole call, whatever order the list was written in.
 *
 * The resolved user is published to `currentUserAtom` and to the request
 * **before** the guard runs, so anything the guard calls (a repository read in
 * `$owns`, for instance) resolves the same tenant the handler would.
 *
 * ## Browser Behavior
 *
 * On the server, `$secure` throws `UnauthorizedError` or `ForbiddenError`.
 * In the browser, it returns `undefined` instead — the handler is never called.
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
 *
 *   adminManage = $action({
 *     use: [$secure({
 *       issuers: ["main"],
 *       roles: ["admin"],
 *       permissions: ["admin:manage"],
 *       guard: ({ user }) => !!user.email,
 *     })],
 *     handler: () => { ... },
 *   });
 * }
 * ```
 */
export function $secure(options?: SecureOptions): Middleware {
  const { alepha } = $context();
  const securityProvider = alepha.inject(SecurityProvider);

  // Register declared permissions at definition time
  if (options?.permissions?.length) {
    for (const perm of options.permissions) {
      securityProvider.createPermission(perm);
    }
  }

  return createMiddleware({
    name: "$secure",
    options: (options as unknown as Record<string, unknown>) ?? undefined,
    handler: ({ alepha, next }) => {
      return async (...args: any[]) => {
        let user: UserAccountToken | undefined;

        // 1. Atom-first (set by action.run fork, MCP transport, pipelines, jobs)
        user = alepha.store.get(currentUserAtom);

        // 2. HTTP request fallback (walks up fork tree to find real HTTP request)
        if (!user) {
          const httpRequest = alepha.store.get("alepha.http.request");
          if (httpRequest) {
            // 2a. request.user (set by previous middleware)
            user = httpRequest.user;

            // 2b. Resolve from HTTP headers (JWT/API key)
            if (!user) {
              user = await securityProvider.resolveUserFromServerRequest(
                httpRequest,
                { realm: options?.issuers?.[0] },
              );
            }
          }
        }

        // 3. Handle unauthenticated
        if (!user) {
          throw new UnauthorizedError("Authentication required");
        }

        // 4. Issuer check (user must belong to one of the listed issuers)
        securityProvider.checkIssuers(user, options?.issuers);

        // 5. Role check (user must have at least one of the listed roles)
        if (options?.roles?.length) {
          const hasRole = options.roles.some((role) =>
            user!.roles?.includes(role),
          );
          if (!hasRole) {
            throw new ForbiddenError(
              `One of roles '${options.roles.join("', '")}' required`,
            );
          }
        }

        // 6. Explicit permission checks (all must pass) — role names are
        // resolved within the user's own realm, never across realms.
        //
        // `permissions` is an AND list, so the resulting `ownership` must be
        // the MOST RESTRICTIVE of the answers, not the last one. Overwriting
        // per iteration made the outcome depend on the order the caller listed
        // them in: with one owner-scoped grant and one unrestricted grant,
        // putting the unrestricted one last yielded `ownership: false`, which
        // `$owns` reads as a full bypass of its row check.
        if (options?.permissions?.length) {
          let ownership: string | boolean | undefined;

          for (const perm of options.permissions) {
            const result = securityProvider.checkPermissionInRealm(
              user.realm,
              perm,
              ...(user.roles ?? []),
            );
            if (!result.isAuthorized) {
              throw new ForbiddenError(
                `Permission '${typeof perm === "string" ? perm : perm.name}' required`,
              );
            }

            // A truthy ownership narrows the grant to rows the caller owns and
            // always wins. `false` (unrestricted) only fills in a slot nothing
            // has narrowed yet, and `undefined` never overwrites a decision.
            if (result.ownership) {
              ownership = result.ownership;
            } else if (ownership === undefined) {
              ownership = result.ownership;
            }
          }

          user = { ...user, ownership };
        }

        // 7. Publish the resolved user BEFORE the guard runs.
        //
        // A guard runs real code — `$owns` loads a row through a repository —
        // and `Repository.resolveOrganizationValue()` reads `currentUserAtom`.
        // Publishing afterwards meant every guard on the HTTP path (where
        // `$secure` itself resolved the user from headers) queried with no
        // tenant in context: a non-strict entity was read unscoped, and a
        // strict one refused outright with a 500. Over `action.run()` / MCP the
        // atom was already populated by the caller, so the two transports
        // disagreed on the same route.
        //
        // Denial still aborts before `next()`, so a published-then-rejected
        // user is never observable by the handler.
        securityProvider.storeUserInContext(user);

        const httpRequest = alepha.store.get("alepha.http.request", "current");
        if (httpRequest) {
          httpRequest.user = user;
        }

        const actionRequest = alepha.store.get(
          "alepha.action.request",
          "current",
        );
        if (actionRequest) {
          actionRequest.user = user;
        }

        // 8. Custom guard — the only check with request visibility.
        //
        // Awaited: before this was async, returning a promise from a guard
        // made the truthiness check always pass, so an async guard silently
        // allowed everyone through.
        if (options?.guard) {
          // Resolved without the `"current"` scope: `$secure` may run inside a
          // nested fork, and the HTTP request lives on an ancestor layer.
          const request = alepha.store.get("alepha.http.request");
          const source: any =
            alepha.store.get("alepha.action.request", "current") ?? request;

          const allowed = await options.guard({
            user,
            params: source?.params ?? {},
            query: source?.query ?? {},
            body: source?.body,
            request,
            alepha,
          });

          if (!allowed) {
            throw new ForbiddenError("Access denied");
          }
        }

        return next(...args);
      };
    },
  });
}
