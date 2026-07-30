import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { CryptoProvider } from "alepha/crypto";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaServerCors } from "alepha/server/cors";
import { describe, expect, it } from "vitest";
import { SourceIngestController } from "../src/api/controllers/SourceIngestController.ts";
import { blightIgnoreRules } from "../src/api/entities/blightIgnoreRules.ts";
import { blights } from "../src/api/entities/blights.ts";
import { campaignSources } from "../src/api/entities/campaignSources.ts";
import { campaigns } from "../src/api/entities/campaigns.ts";
import { LoreApi } from "../src/api/index.ts";

class Probe {
  campaigns = $repository(campaigns);
  sources = $repository(campaignSources);
  blights = $repository(blights);
  rules = $repository(blightIgnoreRules);
}

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
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

  const controller = alepha.inject(SourceIngestController);
  const crypto = alepha.inject(CryptoProvider);
  const probe = alepha.inject(Probe);
  await alepha.start();

  const campaign = await probe.campaigns.create({
    name: "Test",
    title: "Test",
    createdBy: "00000000-0000-4000-8000-000000000001",
  } as any);

  const token = "src_test_token";
  const source = await probe.sources.create({
    campaignId: campaign.id,
    name: "Pulse",
    tokenHash: crypto.hash(token),
    tokenPrefix: "src_test",
  });

  return { alepha, controller, probe, campaign, source, token };
};

const aFingerprint = (over: Record<string, unknown> = {}) => ({
  fingerprint: "fp1",
  name: "TypeError",
  message: "boom",
  stackSample: "TypeError: boom\n    at f (app.js)",
  sourceUrl: "https://app/",
  origin: "client" as const,
  windowCount: 1,
  firstSeenAt: "2026-07-30T10:00:00.000Z",
  lastSeenAt: "2026-07-30T10:00:00.000Z",
  ...over,
});

const post = (
  controller: SourceIngestController,
  token: string | undefined,
  fingerprints: ReturnType<typeof aFingerprint>[],
) =>
  controller.ingestBlights.run({
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: { fingerprints },
  } as any);

describe("SourceIngestController", () => {
  it("refuses an unknown key the same way as a missing one", async () => {
    const { controller } = await setup();

    // Distinguishing them would let anyone probe for keys that once existed.
    await expect(
      post(controller, undefined, [aFingerprint()]),
    ).rejects.toThrow();
    await expect(
      post(controller, "src_wrong", [aFingerprint()]),
    ).rejects.toThrow();
  });

  it("refuses a revoked key", async () => {
    const { controller, probe, source, token } = await setup();

    await probe.sources.updateById(source.id, {
      revokedAt: new Date().toISOString(),
    } as any);

    await expect(post(controller, token, [aFingerprint()])).rejects.toThrow();
  });

  it("refuses a key without the blight:write scope", async () => {
    const { controller, probe, source, token } = await setup();

    await probe.sources.updateById(source.id, { scopes: ["read"] } as any);

    // A scope list from the start, so widening later cannot silently grant the
    // new power to keys that already exist.
    await expect(post(controller, token, [aFingerprint()])).rejects.toThrow();
  });

  it("keeps one blight per fingerprint and sums the counts", async () => {
    const { controller, probe, campaign, token } = await setup();

    await post(controller, token, [aFingerprint({ windowCount: 30 })]);
    await post(controller, token, [
      aFingerprint({ windowCount: 12, lastSeenAt: "2026-07-30T11:00:00.000Z" }),
    ]);

    const rows = await probe.blights.findMany({
      where: { campaignId: campaign.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(42);
    expect(rows[0].lastSeenAt).toBe("2026-07-30T11:00:00.000Z");
  });

  it("applies ignore rules before insertion, not on read", async () => {
    const { controller, probe, campaign, token } = await setup();

    await probe.rules.create({
      campaignId: campaign.id,
      pattern: "ResizeObserver",
    } as any);

    const res = await post(controller, token, [
      aFingerprint({ fingerprint: "fp-noise", message: "ResizeObserver loop" }),
      aFingerprint({ fingerprint: "fp-real", message: "boom" }),
    ]);

    // Filtering on read would let a muted error keep growing the table and keep
    // inflating every count.
    expect(res.accepted).toBe(1);
    expect(res.ignored).toBe(1);
    expect(
      await probe.blights.findMany({ where: { campaignId: campaign.id } }),
    ).toHaveLength(1);
  });

  it("refuses an oversized batch rather than trimming it", async () => {
    const { controller, token } = await setup();

    const many = Array.from({ length: 51 }, (_, i) =>
      aFingerprint({ fingerprint: `fp${i}` }),
    );

    // Dropping the tail would leave the sender believing it was delivered.
    await expect(post(controller, token, many)).rejects.toThrow();
  });

  it("records when the source last reported, for the dead-man's switch", async () => {
    const { controller, probe, source, token } = await setup();

    expect(source.lastSeenAt).toBeUndefined();
    await post(controller, token, [aFingerprint()]);

    const after = await probe.sources.findOne({ where: { id: source.id } });
    expect(after?.lastSeenAt).toBeTruthy();
  });

  it("refreshes the release and the link back, which describe the bug now", async () => {
    const { controller, probe, campaign, token } = await setup();

    await post(controller, token, [
      aFingerprint({ release: "1.0.0", pulseUrl: "/apps/a/errors/fp1" }),
    ]);
    await post(controller, token, [
      aFingerprint({ release: "1.1.0", pulseUrl: "/apps/a/errors/fp1" }),
    ]);

    const [row] = await probe.blights.findMany({
      where: { campaignId: campaign.id },
    });
    expect(row.release).toBe("1.1.0");
  });
});
