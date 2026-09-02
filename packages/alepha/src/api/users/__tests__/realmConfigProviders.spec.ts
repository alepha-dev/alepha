import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { AlephaServerEtag } from "alepha/server/etag";
import { describe, it } from "vitest";

import { $realm } from "../index.ts";
import type { RealmConfig } from "../schemas/realmConfigSchema.ts";

/**
 * What `/realms/config` advertises, end to end.
 *
 * A provider with no credentials is optional through four links:
 * `$authGithub` / `$authGoogle` compute `disabled` from their env,
 * `ServerAuthProvider.identities` filters the disabled ones out,
 * `getAuthenticationProviders()` walks that filtered list, and
 * `auth-login.tsx` builds its buttons purely from what it is told.
 *
 * None of those links was covered, and breaking any one of them ships a
 * self-hosted image whose login page offers a Google button leading to a
 * 500. The negative case alone would not catch it either: a chain that
 * advertises nothing at all passes it just as happily, which is why the
 * positive case sits in the same file.
 */
describe("alepha/api/users - /realms/config authentication methods", () => {
  const boot = async (env: Record<string, string> = {}) => {
    const alepha = Alepha.create({ env: { ...env } })
      .with(AlephaServer)
      // `RealmController.getRealmConfig` runs `$etag()`, and
      // `AlephaApiUsers` does not import the module that provides it, so a
      // container without it answers 500. Lore gets it through
      // `alepha/react/router`; a server-only app would not.
      .with(AlephaServerEtag)
      .with(AlephaOrmPostgres)
      .with(AlephaSecurity)
      .with(() => ({
        realm: $realm({
          identities: { credentials: true, github: true, google: true },
        }),
      }));
    await alepha.start();

    const { hostname } = alepha.inject(ServerProvider);
    const response = await fetch(`${hostname}/api/realms/config`);
    return { alepha, response, config: (await response.json()) as RealmConfig };
  };

  it("advertises credentials only when no OAuth env is set", async ({
    expect,
  }) => {
    const { alepha, response, config } = await boot();

    expect(response.status).toBe(200);
    expect(config.authenticationMethods).toHaveLength(1);
    expect(config.authenticationMethods[0].type).toBe("CREDENTIALS");

    await alepha.stop();
  });

  it("advertises a provider once its client id AND secret are present", async ({
    expect,
  }) => {
    const { alepha, config } = await boot({
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GITHUB_CLIENT_ID: "github-id",
      GITHUB_CLIENT_SECRET: "github-secret",
    });

    const names = config.authenticationMethods.map((it) => it.name);
    expect(names).toContain("google");
    expect(names).toContain("github");

    await alepha.stop();
  });

  it("keeps a provider hidden when only half its credentials are set", async ({
    expect,
  }) => {
    // Half-configured is the shape an operator actually produces: the id
    // pasted in, the secret still to come.
    const { alepha, config } = await boot({ GOOGLE_CLIENT_ID: "google-id" });

    expect(config.authenticationMethods.map((it) => it.name)).not.toContain(
      "google",
    );

    await alepha.stop();
  });

  it("never puts the privileged-account allowlist on the public endpoint", async ({
    expect,
  }) => {
    const { alepha, config } = await boot();

    // A leak rather than a broken button, and the projection that prevents
    // it (`publicRealmSettingsSchema`) omits exactly these two — which is
    // why `bootstrapFirstUser` is a $realm option and not a setting.
    expect(config.settings).not.toHaveProperty("adminEmails");
    expect(config.settings).not.toHaveProperty("adminUsernames");
    expect(config.settings).toHaveProperty("registrationAllowed");

    await alepha.stop();
  });
});
