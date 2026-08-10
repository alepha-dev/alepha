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
import { LoreAnalytics } from "../src/api/entities/loreAnalytics.ts";
import { projects } from "../src/api/entities/projects.ts";
import { sigils } from "../src/api/entities/sigils.ts";
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
  projects = $repository(projects);
  sigils = $repository(sigils);
}

/**
 * Views, read back through the `$analytics()` dataset that is now the only
 * write `SigilIngestService.absorbViews` makes — see that method's doc.
 */
const readViews = async (analytics: LoreAnalytics, sigilId: string) => {
  const result = await analytics.views.query({
    since: "2000-01-01",
    where: { sigilId: { inArray: [sigilId] } },
    groupBy: ["hour", "path", "country"],
    select: { count: "sum" },
  });
  return result.rows as unknown as Array<{
    hour: string;
    path: string;
    country: string;
    count: number;
  }>;
};

const KEY = "sg_selfreport_fixed_for_the_test";

/**
 * Every project flag that still means something.
 *
 * `blights` / `beacon` / `vitals` are deliberately absent: they are retired
 * `@deprecated` columns nothing reads since capabilities moved onto each
 * sigil's own `kinds`. Writing them here would suggest the gate still consults
 * them — it consults `sigils` and the sigil's kinds.
 */
const allOn = {
  kanban: true,
  folios: true,
  feedback: true,
  milestones: true,
  sigils: true,
};

const setup = async (
  over: { features?: unknown; key?: string; kinds?: string[] } = {},
) => {
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
  const analytics = alepha.inject(LoreAnalytics);
  const crypto = alepha.inject(CryptoProvider);
  const users = alepha.inject(UserService);
  const sink = alepha.inject(SigilSinkProvider);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const project = await probe.projects.create({
    title: "Lore",
    createdBy: owner.id,
    features: over.features ?? allOn,
  } as any);

  // The row is written with the hash of a token we chose, rather than minting
  // one, because `SIGIL_KEY` has to be known before the container boots and
  // `mint()` is random. `verify` looks a sigil up BY hash, so this is the same
  // credential path a real token takes — not a bypass of it.
  const sigil = await probe.sigils.create({
    projectId: project.id,
    name: "lore",
    tokenHash: crypto.hash(KEY),
    tokenPrefix: KEY.slice(0, 10),
    kinds: over.kinds ?? ["beacon", "vitals", "blights", "feedback"],
  });

  return { alepha, probe, analytics, project, sigil, sink };
};

describe("Lore reports to Lore", () => {
  it("should write a batch straight into its own tables, with no sink reachable", async () => {
    const { analytics, sigil, sink } = await setup();

    await sink.ingest({ views: [{ path: "/dogfood" }] }, {});
    await sink.flush();

    const rows = await readViews(analytics, sigil.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/dogfood");
  });

  it("should stamp its own lastSeenAt, so the sigil list does not call it silent", async () => {
    // `lastSeenAt` is what tells an owner an app is reporting at all.
    // Left unstamped, Lore would show as never having sent anything while
    // filling its own tables — the one reading the column exists to prevent.
    const { probe, sigil, sink } = await setup();

    await sink.ingest({ views: [{ path: "/dogfood" }] }, {});
    await sink.flush();

    expect((await probe.sigils.findById(sigil.id))?.lastSeenAt).toBeTruthy();
  });

  it("should read its appetite from the sigil's kinds, not from a default", async () => {
    // The config path is the second self-subrequest, and the easier one to
    // miss: it fails open to "collect everything", so a broken fetch looks
    // exactly like a permissive project. Beacon is withheld via the sigil's
    // own kinds, not a project flag — that flag is retired.
    const { sink } = await setup({
      kinds: ["vitals", "blights", "feedback"],
    });

    await sink.refreshConfig();

    expect(sink.enabledTrackers().views).toBe(false);
    expect(sink.enabledTrackers().errors).toBe(true);
  });

  it("should honour a switched-off project by writing nothing", async () => {
    const { analytics, sigil, sink } = await setup({
      features: { ...allOn, sigils: false },
    });

    await sink.ingest({ views: [{ path: "/dogfood" }] }, {});
    await sink.flush();

    expect(await readViews(analytics, sigil.id)).toHaveLength(0);
  });

  it("should drop the batch rather than throw when SIGIL_KEY names no sigil", async () => {
    /*
      A revoked or mistyped key must degrade the way an unreachable sink does —
      a warning and a lost batch — never an exception escaping into the request
      that happened to trigger the flush. The app is working; its observer is
      not.
    */
    const { analytics, sigil, sink } = await setup({
      key: "sg_not_a_real_token",
    });

    await sink.ingest({ views: [{ path: "/dogfood" }] }, {});
    await expect(sink.flush()).resolves.toBeUndefined();

    expect(await readViews(analytics, sigil.id)).toHaveLength(0);
  });
});
