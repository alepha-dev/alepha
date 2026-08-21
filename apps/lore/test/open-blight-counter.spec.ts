import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { blights } from "@/api/entities/blights.ts";
import type { Project } from "@/api/entities/projects.ts";
import { sigilErrorGroups } from "@/api/entities/sigilErrorGroups.ts";
import { type Sigil, sigils } from "@/api/entities/sigils.ts";
import { LoreApi } from "@/api/index.ts";
import { OpenBlightCounter } from "@/api/services/OpenBlightCounter.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

class BlightTestRepositories {
  sigils = $repository(sigils);
  blights = $repository(blights);
  errorGroups = $repository(sigilErrorGroups);
}

interface TestContext {
  alepha: Alepha;
  counter: OpenBlightCounter;
  repos: BlightTestRepositories;
}

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
  const repos = alepha.inject(BlightTestRepositories);

  await alepha.start();

  return { alepha, counter: alepha.inject(OpenBlightCounter), repos };
};

let tokenSeq = 0;

const createSigil = async (
  ctx: TestContext,
  project: Project,
  name: string,
): Promise<Sigil> => {
  tokenSeq += 1;
  return ctx.repos.sigils.create({
    projectId: project.id,
    name,
    tokenHash: `hash-${tokenSeq}`,
    tokenPrefix: `sg_${tokenSeq}`,
    kinds: ["blights"],
  });
};

/**
 * Reproduces what an ingest writes: a per-app error group AND the shared
 * project-wide blight row, with `blights.sigilId` set to the latest reporter.
 */
const report = async (
  ctx: TestContext,
  sigil: Sigil,
  fingerprint: string,
  count = 1,
  status = "open",
): Promise<void> => {
  const now = "2026-08-20T10:00:00.000Z";
  const existingGroup = await ctx.repos.errorGroups.findOne({
    where: { sigilId: { eq: sigil.id }, fingerprint: { eq: fingerprint } },
  });
  if (existingGroup) {
    await ctx.repos.errorGroups.updateOne(
      { id: { eq: existingGroup.id } },
      { count: (existingGroup.count ?? 0) + count },
    );
  } else {
    await ctx.repos.errorGroups.create({
      sigilId: sigil.id,
      fingerprint,
      name: "TypeError",
      message: "boom",
      stackSample: "",
      sourceUrl: "",
      firstSeenAt: now,
      lastSeenAt: now,
      count,
    });
  }

  const existingBlight = await ctx.repos.blights.findOne({
    where: {
      projectId: { eq: sigil.projectId },
      fingerprint: { eq: fingerprint },
    },
  });
  if (existingBlight) {
    await ctx.repos.blights.updateOne(
      { id: { eq: existingBlight.id } },
      {
        count: (existingBlight.count ?? 0) + count,
        // The trap this whole service exists for: last reporter wins.
        sigilId: sigil.id,
      },
    );
  } else {
    await ctx.repos.blights.create({
      projectId: sigil.projectId,
      sigilId: sigil.id,
      fingerprint,
      name: "TypeError",
      message: "boom",
      firstSeenAt: now,
      lastSeenAt: now,
      count,
      status,
    });
  }
};

describe("OpenBlightCounter", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("counts a bug present in two selected apps once", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const web = await createSigil(ctx, project, "web");
    const api = await createSigil(ctx, project, "api");
    await report(ctx, web, "fp-shared", 3);
    await report(ctx, api, "fp-shared", 4);

    const result = await ctx.counter.count({
      projectIds: [project.id],
      sigilIds: [web.id, api.id],
      status: "open",
    });

    expect(result.count).toBe(1);
    // Occurrences come from the two groups, not from the blight row.
    expect(result.occurrences).toBe(7);
    expect(result.apps).toBe(2);
  });

  it("stays stable when an unselected app reports the same bug last", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const web = await createSigil(ctx, project, "web");
    const other = await createSigil(ctx, project, "other");
    await report(ctx, web, "fp-shared", 2);

    const before = await ctx.counter.count({
      projectIds: [project.id],
      sigilIds: [web.id],
      status: "open",
    });

    // `blights.sigilId` now points at an app the card never selected. A count
    // filtered on that column would drop to zero here; this one must not move.
    await report(ctx, other, "fp-shared", 50);

    const after = await ctx.counter.count({
      projectIds: [project.id],
      sigilIds: [web.id],
      status: "open",
    });

    expect(before.count).toBe(1);
    expect(after.count).toBe(1);
    expect(after.occurrences).toBe(2);
    expect(after.apps).toBe(1);
  });

  it("excludes resolved and quest-forwarded blights", async ({ expect }) => {
    const project = await createTestProject(ctx.alepha);
    const web = await createSigil(ctx, project, "web");
    await report(ctx, web, "fp-open");
    await report(ctx, web, "fp-resolved", 1, "resolved");
    await report(ctx, web, "fp-quest", 1, "quest:42");

    const open = await ctx.counter.count({
      projectIds: [project.id],
      sigilIds: [web.id],
      status: "open",
    });
    const all = await ctx.counter.count({
      projectIds: [project.id],
      sigilIds: [web.id],
      status: "all",
    });

    expect(open.count).toBe(1);
    expect(all.count).toBe(3);
  });

  it("does not count a group whose blight row has been purged", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const web = await createSigil(ctx, project, "web");
    await report(ctx, web, "fp-aged", 9);

    // What `BlightJobs.purgeStaleBlights` does past `retentionDays`. Nothing
    // purges `sigil_error_groups`, so the group outlives its triage row.
    await ctx.repos.blights.deleteMany({ fingerprint: { eq: "fp-aged" } });

    const result = await ctx.counter.count({
      projectIds: [project.id],
      sigilIds: [web.id],
      status: "open",
    });

    expect(result).toEqual({ count: 0, occurrences: 0, apps: 0 });
  });

  it("never counts a fingerprint through another project's app", async ({
    expect,
  }) => {
    const mine = await createTestProject(ctx.alepha);
    const theirs = await createTestProject(ctx.alepha);
    const myApp = await createSigil(ctx, mine, "web");
    const theirApp = await createSigil(ctx, theirs, "web");
    // The same bug, independently present in both projects: two blight rows.
    await report(ctx, myApp, "fp-common");
    await report(ctx, theirApp, "fp-common");

    const result = await ctx.counter.count({
      projectIds: [mine.id],
      sigilIds: [myApp.id],
      status: "open",
    });

    expect(result.count).toBe(1);
    expect(result.topProjectId).toBe(mine.id);
  });

  it("counts every blight in a project scope, including unattributed ones", async ({
    expect,
  }) => {
    const project = await createTestProject(ctx.alepha);
    const web = await createSigil(ctx, project, "web");
    await report(ctx, web, "fp-attributed", 2);
    // A row from before the per-app split existed: no error group at all.
    await ctx.repos.blights.create({
      projectId: project.id,
      fingerprint: "fp-legacy",
      name: "TypeError",
      message: "old",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      count: 5,
      status: "open",
    });

    const project_ = await ctx.counter.count({
      projectIds: [project.id],
      status: "open",
    });
    const apps_ = await ctx.counter.count({
      projectIds: [project.id],
      sigilIds: [web.id],
      status: "open",
    });

    // The project scope matches the inbox; the app scope can only see what is
    // attributable, and says so by counting less.
    expect(project_.count).toBe(2);
    expect(project_.occurrences).toBe(7);
    expect(project_.apps).toBe(1);
    expect(apps_.count).toBe(1);
  });

  it("counts across projects and points the drill-through at the busiest", async ({
    expect,
  }) => {
    const quiet = await createTestProject(ctx.alepha);
    const busy = await createTestProject(ctx.alepha);
    const quietApp = await createSigil(ctx, quiet, "web");
    const busyApp = await createSigil(ctx, busy, "web");
    await report(ctx, quietApp, "fp-1");
    await report(ctx, busyApp, "fp-1");
    await report(ctx, busyApp, "fp-2");

    const result = await ctx.counter.count({
      projectIds: [quiet.id, busy.id],
      sigilIds: [quietApp.id, busyApp.id],
      status: "open",
    });

    expect(result.count).toBe(3);
    expect(result.apps).toBe(2);
    expect(result.topProjectId).toBe(busy.id);
  });

  it("answers zero for an empty scope", async ({ expect }) => {
    expect(await ctx.counter.count({ projectIds: [], status: "open" })).toEqual(
      {
        count: 0,
        occurrences: 0,
        apps: 0,
      },
    );
  });
});
