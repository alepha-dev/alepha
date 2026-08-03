import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { describe, it } from "vitest";
import { campaigns } from "../src/api/entities/campaigns.ts";
import { releases } from "../src/api/entities/releases.ts";
import { LoreApi } from "../src/api/index.ts";

class Probe {
  campaigns = $repository(campaigns);
  releases = $repository(releases);
}

/**
 * The registry's storage guarantees, before any controller sits on top.
 *
 * Every case here is about the unique index, because it is the only thing
 * standing between "redeploy the same version" and two rows racing for one
 * environment — and an index is not something a handler can be trusted to
 * enforce on its own.
 */
describe("releases entity", () => {
  const setup = async () => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        SERVER_PORT: 0,
        SERVER_HOST: "127.0.0.1",
        DATABASE_URL: ":memory:",
        PUBLIC_URL: "https://lore.test",
      },
    });

    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaServerCors);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(LoreApi);

    const probe = alepha.inject(Probe);
    const users = alepha.inject(UserService);
    await alepha.start();

    const owner = await users.createUser({ username: "owner" });
    const campaign = await probe.campaigns.create({
      title: "Test",
      createdBy: owner.id,
    });

    const base = {
      campaignId: campaign.id,
      app: "lindocara-main",
      environment: "production",
      version: "2026-08-03-120000",
      sha256: "a".repeat(64),
      fileId: "11111111-1111-4111-8111-111111111111",
    };

    return { probe, base };
  };

  it("stores a new release as pending, claimed by nobody", async ({
    expect,
  }) => {
    const { probe, base } = await setup();

    const created = await probe.releases.create(base);

    expect(created.status).toBe("pending");
    expect(created.claimedAt).toBeUndefined();
    expect(created.outpostId).toBeUndefined();
  });

  it("refuses a second release with the same version for one app and environment", async ({
    expect,
  }) => {
    const { probe, base } = await setup();
    await probe.releases.create(base);

    await expect(probe.releases.create(base)).rejects.toThrow();
  });

  it("allows the same version in two different environments", async ({
    expect,
  }) => {
    const { probe, base } = await setup();
    await probe.releases.create(base);

    const staging = await probe.releases.create({
      ...base,
      environment: "staging",
    });

    expect(staging.environment).toBe("staging");
  });
});
