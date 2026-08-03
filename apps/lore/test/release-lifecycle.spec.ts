import { Alepha } from "alepha";
import { files } from "alepha/api/files";
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
import { ReleaseService } from "../src/api/services/ReleaseService.ts";

class Probe {
  campaigns = $repository(campaigns);
  releases = $repository(releases);
  files = $repository(files);
}

/**
 * Boots the app, a campaign, and one already-uploaded artifact.
 *
 * The `files` row is written directly rather than pushed through the upload
 * endpoint: what is under test is the registry sitting on top of a stored
 * file, and driving multipart here would test the framework's upload path a
 * third time.
 */
const setupService = async () => {
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
  const service = alepha.inject(ReleaseService);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const campaign = await probe.campaigns.create({
    title: "Test",
    createdBy: owner.id,
  });
  const file = await probe.files.create({
    blobId: "blob-1",
    bucket: ReleaseService.BUCKET,
    name: "lindocara-main-latest.tar.gz",
    size: 33_352_058,
    mimeType: "application/gzip",
  });

  return { service, campaignId: campaign.id, fileId: file.id };
};

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

/**
 * The write path, where the digest and the artifact are checked.
 *
 * Both refusals happen before the row exists on purpose: a release carrying a
 * malformed digest or pointing at nothing would send every outpost that claims
 * it into a download it can only reject, and the failure would surface on the
 * machine rather than in the pipeline that caused it.
 */
describe("ReleaseService.register", () => {
  const digest = "b".repeat(64);

  it("refuses a digest that is not 64 hex characters", async ({ expect }) => {
    const { service, campaignId, fileId } = await setupService();

    await expect(
      service.register({
        campaignId,
        app: "lindocara-main",
        environment: "production",
        version: "v1",
        sha256: "NOT-A-DIGEST",
        fileId,
      }),
    ).rejects.toThrow(/sha256/i);
  });

  it("accepts an uppercase digest and stores it lowercase", async ({
    expect,
  }) => {
    const { service, campaignId, fileId } = await setupService();

    const release = await service.register({
      campaignId,
      app: "lindocara-main",
      environment: "production",
      version: "v1",
      sha256: digest.toUpperCase(),
      fileId,
    });

    expect(release.sha256).toBe(digest);
  });

  it("refuses a fileId that no upload produced", async ({ expect }) => {
    const { service, campaignId } = await setupService();

    await expect(
      service.register({
        campaignId,
        app: "lindocara-main",
        environment: "production",
        version: "v1",
        sha256: digest,
        fileId: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toThrow(/upload first/i);
  });

  it("answers a conflict rather than a second row for a version already on file", async ({
    expect,
  }) => {
    const { service, campaignId, fileId } = await setupService();
    const input = {
      campaignId,
      app: "lindocara-main",
      environment: "production",
      version: "v1",
      sha256: digest,
      fileId,
    };
    await service.register(input);

    await expect(service.register(input)).rejects.toThrow(/already exists/i);
  });
});
