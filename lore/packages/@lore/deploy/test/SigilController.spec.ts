import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreDeployApi } from "../src/api/index.ts";
import { SigilIngestService } from "../src/api/index.ts";
import { type Sigil, sigils } from "../src/schemas/index.ts";
import { createTestProject, DeployTestEntities } from "../src/testing/index.ts";

/**
 * `sigils` is not part of `DeployTestEntities`, so this spec registers it
 * itself — pre-`start()`, like everything else the schema sync has to see. Its
 * own FK closure (`projects`, `users`) is covered by that class.
 */
class SigilRepositories {
  sigils = $repository(sigils);
}

interface TestContext {
  alepha: Alepha;
  ingest: SigilIngestService;
  repos: SigilRepositories;
}

/**
 * Pinned, like every other lore spec: the ROOT vitest config — the one CI
 * runs — sets `DATABASE_URL` to a Postgres URL, which this app's SQLite
 * provider rejects outright. A bare `Alepha.create()` passes under
 * `yarn w lore test` and fails under `yarn test`.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreDeployApi);

  alepha.inject(DeployTestEntities);
  const repos = alepha.inject(SigilRepositories);

  await alepha.start();

  return {
    alepha,
    ingest: alepha.inject(SigilIngestService),
    repos,
  };
};

/**
 * A sigil row straight through the repository, bypassing the token service.
 * Nothing here reads the credential — every test drives the ingest service with
 * the row itself.
 */
let sigilSeq = 0;
const createTestSigil = async (
  ctx: TestContext,
  projectId: number,
  overrides: Partial<Sigil> = {},
): Promise<Sigil> => {
  sigilSeq += 1;
  return ctx.repos.sigils.create({
    projectId,
    name: `app-${sigilSeq}`,
    tokenHash: `hash-${sigilSeq}`,
    tokenPrefix: "sg_test_",
    kinds: ["beacon"],
    ...overrides,
  });
};

describe("SigilIngestService — the host an app reports from", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("records the host, beside the timestamp it already stamped", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id);

    await ctx.ingest.absorb(sigil, {
      views: [{ path: "/" }],
      host: "alepha.dev",
    });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost).toBe("alepha.dev");
    expect(stored.lastSeenAt).toBeTruthy();
  });

  it("records it even for a batch every gate rejected", async ({ expect }) => {
    // The fixture project has no `features`, so nothing in this envelope is
    // written. Where the app answers is Lore's own bookkeeping, like
    // `lastSeenAt` — it does not depend on what the app was allowed to say.
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id, { kinds: [] });

    await ctx.ingest.absorb(sigil, {
      views: [{ path: "/" }],
      host: "alepha.dev",
    });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost).toBe("alepha.dev");
  });

  it("normalizes what it is given rather than trusting it", async ({
    expect,
  }) => {
    // The sender ran the same normalization, and the sender is whoever holds
    // the token.
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id);

    await ctx.ingest.absorb(sigil, { host: "ALEPHA.dev." });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost).toBe("alepha.dev");
  });

  it("ignores a host that is not an authority", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id);

    await ctx.ingest.absorb(sigil, { host: "https://evil.example.com/x" });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost ?? null).toBeNull();
  });

  it("keeps the last known host when a batch names none", async ({
    expect,
  }) => {
    // A cron, a queue worker, or a server error raised at boot has no inbound
    // request to name. Letting that clear the column would make the address
    // blink empty in the UI every time an app reported from anywhere but a
    // page view.
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id, {
      lastSeenHost: "alepha.dev",
    });

    await ctx.ingest.absorb(sigil, { views: [{ path: "/" }] });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost).toBe("alepha.dev");
  });

  it("follows an app that moves domain", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const sigil = await createTestSigil(ctx, project.id, {
      lastSeenHost: "old.example.com",
    });

    await ctx.ingest.absorb(sigil, { host: "alepha.dev" });

    const stored = await ctx.repos.sigils.getById(sigil.id);
    expect(stored.lastSeenHost).toBe("alepha.dev");
  });
});
