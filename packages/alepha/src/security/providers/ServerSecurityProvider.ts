import { randomUUID } from "node:crypto";
import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import type { ServerRequest } from "alepha/server";
import { currentUserAtom } from "../atoms/currentUserAtom.ts";
import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";
import { JwtProvider } from "./JwtProvider.ts";
import { SecurityProvider } from "./SecurityProvider.ts";

export class ServerSecurityProvider {
  protected readonly log = $logger();
  protected readonly securityProvider = $inject(SecurityProvider);
  protected readonly jwtProvider = $inject(JwtProvider);
  protected readonly alepha = $inject(Alepha);

  protected readonly onServerRequest = $hook({
    on: "server:onRequest",
    priority: "last",
    handler: async ({ request }) => {
      // Resolve user from authorization header (authentication).
      // This makes currentUserAtom available on ALL routes, not just $secure ones.
      // $secure() then acts purely as an authorization gate.
      if (request.headers.authorization) {
        try {
          const user =
            await this.securityProvider.resolveUserFromServerRequest(request);
          if (user) {
            this.securityProvider.storeUserInContext(user);
            request.user = user;
          }
        } catch (error) {
          this.log.debug(
            "Failed to resolve user from request authorization header",
            error,
          );
          // Invalid/expired token — request continues as unauthenticated
        }
      }
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // action:onRequest — resolve user from options, request fork for ALS isolation
  // ---------------------------------------------------------------------------------------------------------------

  protected readonly onActionRequest = $hook({
    on: "action:onRequest",
    handler: async (data) => {
      if (!data.options.user) return;

      let user: UserAccountToken | undefined;

      if (typeof data.options.user === "object") {
        user = data.options.user;
      } else if (data.options.user === "system") {
        user = this.alepha.store.get("alepha.security.system.user");
      } else if (data.options.user === "context") {
        const ctx = this.alepha.store.get("alepha.http.request");
        user = ctx?.user;
      }

      if (user) {
        data.context = { [currentUserAtom.key]: user };
      }
    },
  });

  // ---------------------------------------------------------------------------------------------------------------
  // client:onRequest — automatic test token creation for .fetch()
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
      if (!options.user) {
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

export type ServerSecurityUserResolver = (
  request: ServerRequest,
) => Promise<UserAccountToken | undefined>;
