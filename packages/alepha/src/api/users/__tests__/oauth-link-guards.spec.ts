import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, expect, it } from "vitest";

import { $realm, RealmProvider, SessionService } from "../index.ts";

class Realms {
  a = $realm({ issuer: { name: "tenant-a" }, identities: {} });
}

const boot = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(Realms);
  await alepha.start();
  return alepha;
};

const suffix = () => Math.random().toString(36).slice(2, 8);

describe("SessionService.link guards", () => {
  it("refuses a disabled account that signs in through its OAuth identity", async () => {
    const alepha = await boot();
    const tag = suffix();
    const realmProvider = alepha.inject(RealmProvider);
    const sessionService = alepha.inject(SessionService);
    const users = realmProvider.userRepository("tenant-a");
    const identities = realmProvider.identityRepository("tenant-a");

    const user = await users.create({
      realm: "tenant-a",
      email: `disabled-${tag}@example.com`,
      username: `dis${tag}`,
      enabled: false,
    });
    await identities.create({
      userId: user.id,
      provider: "github",
      providerUserId: `gh-${tag}`,
    });

    // `login()` and `refreshSession()` already refused a disabled account;
    // the OAuth path let it back in.
    await expect(
      sessionService.link(
        "github",
        { sub: `gh-${tag}`, email: user.email, email_verified: true },
        "tenant-a",
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("refuses to auto-link a disabled account by email", async () => {
    const alepha = await boot();
    const tag = suffix();
    const realmProvider = alepha.inject(RealmProvider);
    const sessionService = alepha.inject(SessionService);
    const users = realmProvider.userRepository("tenant-a");

    const user = await users.create({
      realm: "tenant-a",
      email: `dormant-${tag}@example.com`,
      username: `dor${tag}`,
      enabled: false,
    });

    await expect(
      sessionService.link(
        "google",
        { sub: `g-${tag}`, email: user.email, email_verified: true },
        "tenant-a",
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("refuses a profile without an email instead of handing back a ghost", async () => {
    const alepha = await boot();
    const tag = suffix();
    const sessionService = alepha.inject(SessionService);

    // The bare profile used to flow into the session path as a user id and
    // die on the sessions -> users foreign key.
    await expect(
      sessionService.link(
        "microsoft",
        { sub: `ms-${tag}`, name: "No Email" },
        "tenant-a",
      ),
    ).rejects.toThrow(BadRequestError);
  });
});
