import { $env, z } from "alepha";
import { $realm } from "alepha/api/users";

/**
 * Realm configuration for Lore — identities, session policy, enabled
 * user-module features.
 *
 * **Only the realm lives here.** Project access gates
 * (`assertMember` / `assertOwner` / `isMember`) are in
 * `ProjectSecurityService`. `$realm` registers services into the container
 * from inside the field initializer below, so any class declaring it becomes
 * a hub: everything that injected it for an authorization check also dragged
 * in realm registration, and `LoreFileAccessProvider` doing so closed a cycle
 * back into this class's own construction.
 */
export class AppSecurityProvider {
  env = $env(
    z.object({
      ADMIN_EMAIL: z.email().optional(),
      // When set, lore registers `TurnstileCaptchaProvider` in `main.server.ts`
      // and the register flow gates on a Turnstile token. When absent, the
      // realm advertises `captchaRequired: false` so the client doesn't try to
      // render a widget it can't satisfy.
      TURNSTILE_SITE_KEY: z.text({ secret: false }).optional(),
      // Per-IP registration cap. Defaults to the framework default (10).
      // E2E test env bumps this to 1000 so a single localhost IP doesn't
      // burn through the limit while the suite runs.
      REGISTRATION_IP_MAX_ATTEMPTS: z
        .integer()
        .min(1)
        .meta({ secret: false })
        .optional(),
    }),
  );

  realm = $realm({
    features: {
      apiKeys: true,
      avatars: true,
      audits: true,
      jobs: true,
      notifications: true,
      // OAuth 2.1 authorization server — lets MCP clients (Claude) connect
      // to `/mcp` via Dynamic Client Registration instead of a pasted
      // `?api_key=` query string. The legacy api-key path stays working.
      oauth: true,
    },
    settings: {
      username: "email",
      usernameBlocklist: ["admin", "root", "me", "api", "support", "system"],
      resetPasswordAllowed: true,
      verifyEmailRequired: true,
      captchaRequired: !!this.env.TURNSTILE_SITE_KEY,
      registrationIpMaxAttempts: this.env.REGISTRATION_IP_MAX_ATTEMPTS
        ? Number(this.env.REGISTRATION_IP_MAX_ATTEMPTS)
        : undefined,
      adminEmails: this.env.ADMIN_EMAIL ? [this.env.ADMIN_EMAIL] : [],
      // Sliding idle window: a session (web login or OAuth/MCP connection)
      // unused for 30 days is invalidated even before the absolute ceiling.
      // Actively-used connections keep refreshing and never hit this.
      refreshToken: {
        expirationIdle: 30 * 24 * 60 * 60 * 1000,
      },
    },
    issuer: {
      settings: {
        // Absolute ceiling: even a continuously-used session must re-auth
        // after 180 days. Pairs with `expirationIdle` above — active
        // connections live up to here, abandoned ones die at 30 days idle.
        refreshToken: {
          expiration: [180, "days"],
        },
      },
    },
    identities: {
      github: true,
      google: true,
      credentials: true,
    },
  });
}
