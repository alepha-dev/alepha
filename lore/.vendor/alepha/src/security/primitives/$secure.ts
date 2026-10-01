import {
  $context,
  type Alepha,
  type Async,
  createMiddleware,
  MIDDLEWARE_PROTECTED,
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
   *
   * Each is checked against the caller's roles, then against the credential's
   * `permissionScope` (see `userAccountInfoSchema`): a scoped credential is
   * refused a permission its roles grant when its scope excludes it.
   *
   * ⚠️ A scope binds permission-checked routes ONLY. A route declaring no
   * `permissions` (a bare `$secure()`, or `$secure({ roles })`) admits a
   * scoped credential whatever its scope says. That is deliberate: denying
   * them would break `whoami`-shaped reads and `/api/_links`, and a credential
   * that cannot read the registry is unusable by an MCP client. A scope
   * narrows what a credential may DO, not what it may SEE, so "scoped to
   * `project:read`" is a narrower claim than it sounds.
   */
  permissions?: (string | Permission)[];

  /**
   * Require a signed-in session: refuse an identity authenticated by a
   * machine credential, whatever it may otherwise do.
   *
   * A machine credential is not a session. An API key, or the access token a
   * connected app obtained through the OAuth authorization server (trusted
   * first-party clients included), may read, and call the permission-checked
   * actions its roles and scope allow, but a route that
   * mints or revokes credentials, approves an OAuth grant, or changes the
   * account is something a person does from a signed-in session. Declare this
   * on every such route: in the framework, the key-minting routes and every
   * non-GET route under `/users/me`, by path rather than by judgement, so the
   * next account route is covered by reading its path.
   *
   * It refuses any identity carrying a `credential` marker (see
   * `userAccountInfoSchema`), not a credential type by name. The refusal is a
   * 403 saying the route needs a signed-in session, so it does not read as a
   * missing role.
   *
   * Next to the permission scope rule on {@link permissions}: a scope decides
   * what a credential may do on permission-checked routes; this decides the
   * routes no machine credential reaches at all.
   */
  sessionOnly?: boolean;

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
 * 1. `currentUserAtom`: set by `action.run()` fork, MCP transport, pipelines, jobs
 * 2. `request.user`: set by previous middleware
 * 3. HTTP headers - JWT/API key resolution
 *
 * ## Check Order
 *
 * When multiple options are provided, they are checked in this fixed order.
 * All provided options must pass (AND). Each option has its own logic:
 *
 * 1. **Authentication**: Is there a valid user? → `UnauthorizedError` (401)
 *    With `sessionOnly`, is it a signed-in session rather than a machine credential? → `ForbiddenError` (403)
 * 2. **Issuers** (OR): Does the user's realm match at least one? → `ForbiddenError` (403)
 * 3. **Roles** (OR): Does the user have at least one of the listed roles? → `ForbiddenError` (403)
 * 4. **Permissions** (AND): Does the user's role grant all listed permissions, and does the credential's `permissionScope` admit them? → `ForbiddenError` (403)
 * 5. **Guard**: Does the custom function return `true`? → `ForbiddenError` (403)
 *
 * Permissions declared in `$secure()` are auto-created in the permission registry at definition time.
 *
 * Because `permissions` is an AND list, the resulting `ownership` is the most
 * restrictive of the matched grants - one owner-scoped permission narrows the
 * whole call, whatever order the list was written in.
 *
 * The resolved user is published to `currentUserAtom` and to the request
 * **before** the guard runs, so anything the guard calls (a repository read in
 * `$owns`, for instance) sees the same identity the handler would.
 *
 * ## Browser Behavior
 *
 * On the server, `$secure` throws `UnauthorizedError` or `ForbiddenError`.
 * In the browser, it returns `undefined` instead - the handler is never called.
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
    // Declares the capability rather than relying on being recognised by name,
    // so consumers (the router's rendering-mode default) never match on
    // `"$secure"`. Any middleware that turns a visitor away for who they are
    // should set the same flag.
    meta: { [MIDDLEWARE_PROTECTED]: "true" },
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
              user =
                await securityProvider.resolveUserFromServerRequest(
                  httpRequest,
                );
            }
          }
        }

        // 3. Handle unauthenticated
        if (!user) {
          throw new UnauthorizedError("Authentication required");
        }

        // 3b. A machine credential is not a session: refused before anything
        // else is asked of it, so the answer never depends on its roles.
        if (
          options?.sessionOnly &&
          securityProvider.isMachineCredential(user)
        ) {
          throw new ForbiddenError(
            `This route requires a signed-in session, and this request was authenticated by a machine credential (${user.credential?.type})`,
          );
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
            // Roles, then the credential's permission scope: a scope narrows
            // the grant and never widens it.
            const result = securityProvider.checkUserPermission(user, perm);
            if (!result.isAuthorized) {
              const name = typeof perm === "string" ? perm : perm.name;
              throw new ForbiddenError(
                result.deniedBy === "scope"
                  ? `Permission '${name}' is outside this credential's permission scope`
                  : `Permission '${name}' required`,
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
        // A guard runs real code. `$owns`, for example, loads a row and reads
        // `currentUserAtom` to decide whether the caller owns it. Publishing
        // afterwards meant a guard on the HTTP path saw no identity, while
        // `action.run()` and MCP already populated the atom. The transports
        // therefore disagreed on the same route.
        //
        // Denial still aborts before `next()`, so a published-then-rejected
        // user is never observable by the handler.
        securityProvider.storeUserInContext(user);

        // `"fork"`, not `"current"`: a layer `$transactional()` nests between
        // the action and this middleware is the same unit of work, while an
        // enclosing action's fork is not (#Q2538).
        const httpRequest = alepha.store.get("alepha.http.request", "fork");
        if (httpRequest) {
          httpRequest.user = user;
        }

        const actionRequest = alepha.store.get("alepha.action.request", "fork");
        if (actionRequest) {
          actionRequest.user = user;
        }

        // 8. Custom guard — the only check with request visibility.
        //
        // Awaited: before this was async, returning a promise from a guard
        // made the truthiness check always pass, so an async guard silently
        // allowed everyone through.
        if (options?.guard) {
          // The HTTP request is resolved without a scope: `$secure` may run
          // inside a nested fork, and the HTTP request lives on an ancestor
          // layer. The action's own request is `"fork"`: through a layer
          // `$transactional()` nested, never up into an enclosing action's.
          const request = alepha.store.get("alepha.http.request");
          const source: any =
            alepha.store.get("alepha.action.request", "fork") ?? request;

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
