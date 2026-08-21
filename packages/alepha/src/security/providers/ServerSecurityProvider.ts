import { $hook, $inject, Alepha } from "alepha";
import { CryptoProvider } from "alepha/crypto";
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
  protected readonly crypto = $inject(CryptoProvider);

  protected readonly onServerRequest = $hook({
    on: "server:onRequest",
    /**
     * Last, and that is load-bearing.
     *
     * Resolvers read `request.cookies`, which `ServerCookiesProvider` fills
     * from a hook in the *normal* tier. Tiers run first → normal → last, so
     * anything earlier than `last` sees no cookies: every session-borne login
     * resolves to nobody, the request continues as anonymous, and `$secure`
     * refuses a caller who is perfectly well authenticated.
     *
     * This is not theoretical. A previous docblock here argued the hook should
     * run before the body is read, on the grounds that resolution "takes only
     * `url` and `headers`". It does not — it takes cookies too. Acting on that
     * comment moved the hook to `first` and broke every cookie-authenticated
     * upload, which only surfaced in Playwright because bearer tokens kept
     * working and no unit test covered the cookie path. There is one now.
     *
     * The cost of running last is real and worth naming: `request.user` is not
     * available to `server:onRequest` consumers that run before this, so a
     * `MultipartCapProvider` resolver cannot key a size budget on the caller.
     * Fixing that means ordering against the cookie hook explicitly rather than
     * hoisting this one blindly — see the `before`/`after` constraints the hook
     * system supports.
     *
     * ⚠️ Either way this resolves *who* is calling; it does not authorise.
     * `$secure` runs later, in the handler chain, so a `z.file()` field is
     * buffered before anyone can be refused regardless of this ordering.
     */
    priority: "last",
    handler: async ({ request }) => {
      // Resolve the user from any supported credential channel — not just the
      // `Authorization` header, but also resolver-specific ones such as an
      // `api_key` query parameter. This makes `currentUserAtom` available on
      // ALL routes (not just `$secure` ones); `$secure()` is then purely an
      // authorization gate. Gating this on the `Authorization` header missed
      // query-param auth, leaving `request.user` undefined for an otherwise
      // authenticated request. Resolvers no-op cheaply when no credential is
      // present, so running them unconditionally is safe.
      try {
        const user =
          await this.securityProvider.resolveUserFromServerRequest(request);
        if (user) {
          this.securityProvider.storeUserInContext(user);
          request.user = user;
        }
      } catch (error) {
        this.log.debug("Failed to resolve user from request", error);
        // Invalid/expired credential — request continues as unauthenticated
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
      id: this.crypto.randomUUID(),
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
          // Stands in for a real access token, so it must carry the same `typ`
          // the resolvers require — otherwise the helper mints a token the
          // server refuses (see JwtProvider.isAccessToken).
          { header: { typ: this.jwtProvider.accessTokenTyp } },
        );

        request.headers.set("authorization", `Bearer ${token}`);
      }
    },
  });
}

export type ServerSecurityUserResolver = (
  request: ServerRequest,
) => Promise<UserAccountToken | undefined>;
