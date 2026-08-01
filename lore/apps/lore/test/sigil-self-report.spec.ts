import { SigilSinkProvider } from "@alepha/sigil/server";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { CryptoProvider } from "alepha/crypto";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";
import { campaigns } from "../src/api/entities/campaigns.ts";
import { sigils } from "../src/api/entities/sigils.ts";
import { sigilViewsHourly } from "../src/api/entities/sigilViewsHourly.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreSigilSinkProvider } from "../src/api/providers/LoreSigilSinkProvider.ts";

/**
 * Lore dogfooding its own sigil.
 *
 * `SIGIL_SINK` points at a host that does not resolve, on purpose. That is the
 * assertion: every test here would fail if the provider reached for the
 * network, because there is nothing at the other end. Rows landing anyway is
 * the proof that the substitution answered in process.
 *
 * It matters that this is provable rather than assumed. Both call sites in the
 * base provider are fail-open, so a version that silently fell back to HTTP
 * would report nothing and say nothing — which is exactly the state the first
 * attempt at dogfooding was deleted in.
 */

class Probe {
  campaigns = $repository(campaigns);
  sigils = $repository(sigils);
  views = $repository(sigilViewsHourly);
}

const KEY = "sg_selfreport_fixed_for_the_test";

const allOn = {
  kanban: true,
  folios: true,
  petitions: true,
  chapters: true,
  sigils: true,
  blights: true,
  beacon: true,
  vitals: true,
};

const setup = async (over: { features?: unknown; key?: string } = {}) => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "silent",
      SERVER_PORT: 0,
      SERVER_HOST: "127.0.0.1",
      DATABASE_URL: ":memory:",
      PUBLIC_URL: "https://lore.test",
      // Unresolvable by construction — see the file comment.
      SIGIL_SINK: "https://sink.invalid",
      SIGIL_KEY: over.key ?? KEY,
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  alepha.with({ provide: SigilSinkProvider, use: LoreSigilSinkProvider });

  const probe = alepha.inject(Probe);
  const crypto = alepha.inject(CryptoProvider);
  const users = alepha.inject(UserService);
  const sink = alepha.inject(SigilSinkProvider);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const campaign = await probe.campaigns.create({
    title: "Lore",
    createdBy: owner.id,
    features: over.features ?? allOn,
  } as any);

  // The row is written with the hash of a token we chose, rather than minting
  // one, because `SIGIL_KEY` has to be known before the container boots and
  // `mint()` is random. `verify` looks a sigil up BY hash, so this is the same
  // credential path a real token takes — not a bypass of it.
  const sigil = await probe.sigils.create({
    campaignId: campaign.id,
    app: "lore",
    environment: "production",
    label: "lore / production",
    tokenHash: crypto.hash(KEY),
    tokenPrefix: KEY.slice(0, 10),
    kinds: ["beacon", "vitals", "blights", "petition"],
  });

  return { alepha, probe, campaign, sigil, sink };
};

describe("Lore reports to Lore", () => {
  it("should write a batch straight into its own tables, with no sink reachable", async () => {
    const { probe, sigil, sink } = await setup();

    await sink.ingest({ views: [{ path: "/dogfood" }] }, {});
    await sink.flush();

    const rows = await probe.views.findMany({
      where: { sigilId: { eq: sigil.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/dogfood");
  });

  it("should stamp its own lastSeenAt, so the sigil list does not call it silent", async () => {
    // `lastSeenAt` is what tells an owner an environment is reporting at all.
    // Left unstamped, Lore would show as never having sent anything while
    // filling its own tables — the one reading the column exists to prevent.
    const { probe, sigil, sink } = await setup();

    await sink.ingest({ views: [{ path: "/dogfood" }] }, {});
    await sink.flush();

    expect((await probe.sigils.findById(sigil.id))?.lastSeenAt).toBeTruthy();
  });

  it("should read its appetite from the campaign toggles, not from a default", async () => {
    // The config path is the second self-subrequest, and the easier one to
    // miss: it fails open to "collect everything", so a broken fetch looks
    // exactly like a permissive campaign.
    const { sink } = await setup({
      features: { ...allOn, beacon: false },
    });

    await sink.refreshConfig();

    expect(sink.enabledTrackers().views).toBe(false);
    expect(sink.enabledTrackers().errors).toBe(true);
  });

  it("should honour a switched-off campaign by writing nothing", async () => {
    const { probe, sigil, sink } = await setup({
      features: { ...allOn, sigils: false },
    });

    await sink.ingest({ views: [{ path: "/dogfood" }] }, {});
    await sink.flush();

    expect(
      await probe.views.findMany({ where: { sigilId: { eq: sigil.id } } }),
    ).toHaveLength(0);
  });

  it("should drop the batch rather than throw when SIGIL_KEY names no sigil", async () => {
    /*
      A revoked or mistyped key must degrade the way an unreachable sink does —
      a warning and a lost batch — never an exception escaping into the request
      that happened to trigger the flush. The app is working; its observer is
      not.
    */
    const { probe, sigil, sink } = await setup({ key: "sg_not_a_real_token" });

    await sink.ingest({ views: [{ path: "/dogfood" }] }, {});
    await expect(sink.flush()).resolves.toBeUndefined();

    expect(
      await probe.views.findMany({ where: { sigilId: { eq: sigil.id } } }),
    ).toHaveLength(0);
  });
});
