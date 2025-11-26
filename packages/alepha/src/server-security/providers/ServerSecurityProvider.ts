import { randomUUID } from "node:crypto";
import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import {
  JwtProvider,
  type Permission,
  SecurityProvider,
  type UserAccountToken,
  userAccountInfoSchema,
} from "alepha/security";
import {
  $action,
  ForbiddenError,
  type ServerRequest,
  UnauthorizedError,
} from "alepha/server";
import {
  type BasicAuthOptions,
  isBasicAuth,
} from "./ServerBasicAuthProvider.ts";

export class ServerSecurityProvider {
  protected readonly log = $logger();
  protected readonly securityProvider = $inject(SecurityProvider);
  protected readonly jwtProvider = $inject(JwtProvider);
  protected readonly alepha = $inject(Alepha);

  protected readonly onConfigure = $hook({
    on: "configure",
    handler: async () => {
      for (const action of this.alepha.descriptors($action)) {
        // -------------------------------------------------------------------------------------------------------------
        // if the action is disabled or not secure, we do NOT create a permission for it
        // -------------------------------------------------------------------------------------------------------------
        if (
          action.options.disabled ||
          action.options.secure === false ||
          this.securityProvider.getRealms().length === 0
        ) {
          continue;
        }

        const secure = action.options.secure;
        if (typeof secure !== "object") {
          this.securityProvider.createPermission({
            name: action.name,
            group: action.group,
            method: action.route.method,
            path: action.route.path,
          });
        }
      }
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  protected readonly onActionRequest = $hook({
    on: "action:onRequest",
    handler: async ({ action, request, options }) => {
      // if you set explicitly secure: false, we assume you don't want any security check
      // but only if no user is provided in options
      if (action.options.secure === false && !options.user) {
        this.log.trace("Skipping security check for route");
        return;
      }

      if (isBasicAuth(action.route.secure)) {
        return;
      }

      const permission = this.securityProvider
        .getPermissions()
        .find(
          (it) =>
            it.path === action.route.path && it.method === action.route.method,
        );

      try {
        request.user = this.createUserFromLocalFunctionContext(
          options,
          permission,
        );

        const route = action.route;
        if (typeof route.secure === "object") {
          this.check(request.user, route.secure);
        }

        this.alepha.state.set(
          "alepha.server.request.user",
          this.alepha.codec.decode(userAccountInfoSchema, request.user),
        );
      } catch (error) {
        if (action.options.secure || permission) {
          throw error;
        }
        // else, we skip the security check
        this.log.trace("Skipping security check for action");
      }
    },
  });

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    priority: "last",
    handler: async ({ request, route }) => {
      // if you set explicitly secure: false, we assume you don't want any security check
      if (route.secure === false) {
        this.log.trace(
          "Skipping security check for route - explicitly disabled",
        );
        return;
      }

      if (isBasicAuth(route.secure)) {
        return;
      }

      const permission = this.securityProvider
        .getPermissions()
        .find((it) => it.path === route.path && it.method === route.method);

      if (!request.headers.authorization && !route.secure && !permission) {
        this.log.trace(
          "Skipping security check for route - no authorization header and not secure",
        );
        return;
      }

      try {
        // set user to request
        request.user = await this.securityProvider.createUserFromToken(
          request.headers.authorization,
          { permission },
        );

        if (typeof route.secure === "object") {
          this.check(request.user, route.secure);
        }

        this.alepha.state.set(
          "alepha.server.request.user",
          // remove sensitive info
          this.alepha.codec.decode(userAccountInfoSchema, request.user),
        );

        this.log.trace("User set from request token", {
          user: request.user,
          permission,
        });
      } catch (error) {
        if (route.secure || permission) {
          throw error;
        }

        // else, we skip the security check
        this.log.trace(
          "Skipping security check for route - error occurred",
          error,
        );
      }
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  protected check(user: UserAccountToken, secure: ServerRouteSecure) {
    if (secure.realm) {
      if (user.realm !== secure.realm) {
        throw new ForbiddenError(
          `User must belong to realm '${secure.realm}' to access this route`,
        );
      }
    }
  }

  /**
   * Get the user account token for a local action call.
   * There are three possible sources for the user:
   * - `options.user`: the user passed in the options
   * - `"system"`: the system user from the state (you MUST set state `server.security.system.user`)
   * - `"context"`: the user from the request context (you MUST be in an HTTP request context)
   *
   * Priority order: `options.user` > `"system"` > `"context"`.
   *
   * In testing environment, if no user is provided, a test user is created based on the SecurityProvider's roles.
   */
  protected createUserFromLocalFunctionContext(
    options: { user?: UserAccountToken | "system" | "context" },
    permission?: Permission,
  ): UserAccountToken {
    const fromOptions =
      typeof options.user === "object" ? options.user : undefined;

    const type = typeof options.user === "string" ? options.user : undefined;

    let user: UserAccountToken | undefined;

    const fromContext = this.alepha.context.get<ServerRequest>("request")?.user;
    const fromSystem = this.alepha.state.get(
      "alepha.server.security.system.user",
    );

    if (type === "system") {
      user = fromSystem;
    } else if (type === "context") {
      user = fromContext;
    } else {
      user = fromOptions ?? fromContext ?? fromSystem;
    }

    if (!user) {
      // in testing mode, we create a test user
      if (this.alepha.isTest() && !("user" in options)) {
        return this.createTestUser();
      }

      throw new UnauthorizedError("User is required for calling this action");
    }

    const roles =
      user.roles ??
      (this.alepha.isTest()
        ? this.securityProvider.getRoles().map((role) => role.name)
        : []);
    let ownership: boolean | string | undefined;

    if (permission) {
      const result = this.securityProvider.checkPermission(
        permission,
        ...roles,
      );
      if (!result.isAuthorized) {
        throw new ForbiddenError(
          `Permission '${this.securityProvider.permissionToString(permission)}' is required for this route`,
        );
      }
      ownership = result.ownership;
    }

    // create a new user object with ownership if needed
    return {
      ...user,
      ownership,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // TESTING ONLY
  // ---------------------------------------------------------------------------------------------------------------

  protected createTestUser(): UserAccountToken {
    return {
      id: randomUUID(),
      name: "Test",
      roles: this.securityProvider.getRoles().map((role) => role.name),
    };
  }

  protected readonly onClientRequest = $hook({
    on: "client:onRequest",
    handler: async ({ request, options }) => {
      if (!this.alepha.isTest()) {
        return;
      }

      // skip helper if user is explicitly set to undefined
      if ("user" in options && options.user === undefined) {
        return;
      }

      request.headers = new Headers(request.headers);

      if (!request.headers.has("authorization")) {
        const test = this.createTestUser();
        const user =
          typeof options?.user === "object" ? options.user : undefined;
        const sub = user?.id ?? test.id;
        const roles = user?.roles ?? test.roles;

        const token = await this.jwtProvider.create(
          {
            sub,
            roles,
          },
          user?.realm ?? this.securityProvider.getRealms()[0]?.name,
        );

        request.headers.set("authorization", `Bearer ${token}`);
      }
    },
  });
}

export type ServerRouteSecure = {
  realm?: string;
  basic?: BasicAuthOptions;
};
