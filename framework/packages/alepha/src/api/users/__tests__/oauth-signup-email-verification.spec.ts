import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { describe, expect, it } from "vitest";

import { $realm, RealmProvider, SessionService } from "../index.ts";

/**
 * A first OAuth login creates the local account. It used to be created with
 * `emailVerified: true` whatever the provider said, so a provider that
 * explicitly denied the address still produced a verified local one.
 */
class TrustingRealms {
  a = $realm({
    issuer: { name: "trusting" },
    identities: { credentials: true },
  });
}

class StrictRealms {
  a = $realm({
    issuer: { name: "strict" },
    identities: { credentials: true },
    settings: { trustProviderEmail: false },
  });
}

const boot = async (realms: new () => unknown) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(realms as never);
  await alepha.start();
  return alepha;
};

const suffix = () => Math.random().toString(36).slice(2, 8);

describe("OAuth sign-up email verification", () => {
  it("creates an unverified account when the provider denies the address", async () => {
    const alepha = await boot(TrustingRealms);
    const tag = suffix();
    const sessionService = alepha.inject(SessionService);
    const users = alepha.inject(RealmProvider).userRepository("trusting");

    const user = await sessionService.link(
      "github",
      {
        sub: `gh-${tag}`,
        email: `denied-${tag}@example.com`,
        email_verified: false,
      },
      "trusting",
    );

    expect((await users.findById(user.id))?.emailVerified).toBe(false);
  });

  it("creates a verified account when the provider vouches for the address", async () => {
    const alepha = await boot(TrustingRealms);
    const tag = suffix();
    const sessionService = alepha.inject(SessionService);
    const users = alepha.inject(RealmProvider).userRepository("trusting");

    const user = await sessionService.link(
      "google",
      {
        sub: `g-${tag}`,
        email: `vouched-${tag}@example.com`,
        email_verified: true,
      },
      "trusting",
    );

    expect((await users.findById(user.id))?.emailVerified).toBe(true);
  });

  it("follows trustProviderEmail when the provider sends no claim", async () => {
    const trusting = await boot(TrustingRealms);
    const strict = await boot(StrictRealms);
    const tag = suffix();

    const trustingUser = await trusting
      .inject(SessionService)
      .link(
        "custom",
        { sub: `c-${tag}`, email: `silent-a-${tag}@example.com` },
        "trusting",
      );
    expect(
      (
        await trusting
          .inject(RealmProvider)
          .userRepository("trusting")
          .findById(trustingUser.id)
      )?.emailVerified,
    ).toBe(true);

    const strictUser = await strict
      .inject(SessionService)
      .link(
        "custom",
        { sub: `c-${tag}`, email: `silent-b-${tag}@example.com` },
        "strict",
      );
    expect(
      (
        await strict
          .inject(RealmProvider)
          .userRepository("strict")
          .findById(strictUser.id)
      )?.emailVerified,
    ).toBe(false);
  });
});
