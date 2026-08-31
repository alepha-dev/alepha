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
      // Whether self-registration is open when the realm has never been
      // configured from the admin Parameters page. See the note on
      // `registrationAllowed` below for why this is a boot-time default and
      // not a live switch.
      REGISTRATION_ALLOWED: z.boolean().meta({ secret: false }).optional(),
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
      // Mints a `$parameter` named `api.realms.default` over the whole
      // settings object below, which `RealmProvider.getSettings()` then reads
      // in preference to the literal. An owner flips `registrationAllowed`
      // from the admin Parameters page with no redeploy.
      //
      // ⚠️ **The settings below become boot-time DEFAULTS, not the live
      // values.** The first time an admin opens the Parameters page, the
      // whole object is written to the `parameters` table as v1
      // ("Auto-seeded from compiled defaults", `ParameterProvider`
      // `getCurrentWithDefault`). From that moment, editing anything in this
      // block changes nothing on a deployed instance: the stored row wins.
      // Env-derived keys (`captchaRequired`, `registrationIpMaxAttempts`,
      // `adminEmails`, `registrationAllowed`) are frozen the same way, so
      // adding `TURNSTILE_SITE_KEY` or `ADMIN_EMAIL` to a running instance
      // also means flipping the matching field in admin.
      parameters: true,
    },
    settings: {
      username: "email",
      usernameBlocklist: ["admin", "root", "me", "api", "support", "system"],
      resetPasswordAllowed: true,
      verifyEmailRequired: true,
      captchaRequired: !!this.env.TURNSTILE_SITE_KEY,
      // Open by default, so lore.alepha.dev keeps accepting signups. A
      // self-hosted image ships `REGISTRATION_ALLOWED=false` instead and
      // opens itself through the empty-users-table bootstrap exception.
      //
      // This is a default and not a gate: once the parameter row exists the
      // env var is inert, and the switch lives in admin. Setting it after
      // first boot is a no-op, which is the intended shape: a self-hosted
      // operator closes an instance permanently from the UI, not by editing
      // a compose file nobody re-reads.
      registrationAllowed: this.env.REGISTRATION_ALLOWED !== false,
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
