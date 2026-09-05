import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { type Sigil, sigils } from "../entities/sigils.ts";
import { LoreApi } from "../index.ts";
import { SigilIngestService } from "../services/SigilIngestService.ts";
import { SigilController } from "./SigilController.ts";

/**
 * `sigils` is not part of `TestEntityRepositories`, so this spec registers it
 * itself — pre-`start()`, like everything else the schema sync has to see. Its
 * own FK closure (`projects`, `users`) is covered by that class.
 */
class SigilRepositories {
  sigils = $repository(sigils);
}

interface TestContext {
  alepha: Alepha;
  controller: SigilController;
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
  alepha.with(LoreApi);

  alepha.inject(TestEntityRepositories);
  const repos = alepha.inject(SigilRepositories);

  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(SigilController),
    ingest: alepha.inject(SigilIngestService),
    repos,
  };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

/**
 * A sigil row straight through the repository, bypassing the token service.
 * Nothing here reads the credential — every test drives the controller with an
 * owner token, or the ingest service with the row itself.
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

describe("SigilController — what the inventory carries", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("surfaces both the pinned URL and the reported host", async ({
    expect,
  }) => {
    // Both halves cross, not one resolved answer: the Settings field shows the
    // detected host as its placeholder, so an empty field can read as "using
    // what the app reports" rather than as "unset".
    const project = await createTestProject(ctx.alepha);
    await createTestSigil(ctx, project.id, {
      url: "https://alepha.dev",
      lastSeenHost: "docs.alepha.dev",
    });

    const { items } = await ctx.controller.listSigils(
      { params: { projectId: project.id } },
      { user: ownerToken(project) },
    );

    expect(items[0]).toMatchObject({
      url: "https://alepha.dev",
      lastSeenHost: "docs.alepha.dev",
    });
  });
});

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
