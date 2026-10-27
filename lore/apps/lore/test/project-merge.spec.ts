import { ProjectMergeService } from "@lore/core/api";
import { appInstances, qualityRuns, sigils } from "@lore/deploy/schemas";
import { Alepha } from "alepha";
import { organizationMembers } from "alepha/api/organizations";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm, DatabaseProvider } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * The deploy and project-level tables of a project merge, and the sweep
 * that keeps every project-scoped table accounted for (#E94, #Q2782,
 * folio #F1401).
 */
class Probe {
  public readonly instances = $repository(appInstances);
  public readonly sigils = $repository(sigils);
  public readonly quality = $repository(qualityRuns);
  public readonly members = $repository(organizationMembers);
}

/**
 * Tables that carry a `project_id` but are not the project's data: rows
 * another table already moves, or that never belonged to one project.
 * A table added here says why.
 */
const NOT_MOVED: Record<string, string> = {};
// The audit trail is not here because it has no `project_id`: `audits` is
// scoped by `scope_type` / `scope_id`, and its rows stay with the source on
// purpose, as the history of what happened there.

interface TestContext {
  alepha: Alepha;
  merge: ProjectMergeService;
  probe: Probe;
  repos: TestEntityRepositories;
  database: DatabaseProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  bootLore(alepha);
  const probe = alepha.inject(Probe);
  const repos = alepha.inject(TestEntityRepositories);
  await alepha.start();
  return {
    alepha,
    merge: alepha.inject(ProjectMergeService),
    probe,
    repos,
    database: alepha.inject(DatabaseProvider),
  };
};

describe("ProjectMergeService across every module", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("accounts for every table with a project_id, moved or left on purpose", async ({
    expect,
  }) => {
    const tables = await ctx.database.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const scoped: string[] = [];
    for (const row of tables) {
      const name = String(row.name);
      const columns = await ctx.database.execute(
        `SELECT name FROM pragma_table_info('${name}')`,
      );
      if (columns.some((column) => column.name === "project_id")) {
        scoped.push(name);
      }
    }
    const handled = new Set([...ctx.merge.tables(), ...Object.keys(NOT_MOVED)]);

    expect(scoped.filter((name) => !handled.has(name))).toEqual([]);
    expect(scoped.length).toBeGreaterThan(20);
  });

  it("refuses a deployed copy both projects hold, and names it on a dry run", async ({
    expect,
  }) => {
    const target = await createTestProject(ctx.alepha);
    const source = await createTestProject(ctx.alepha);
    await ctx.probe.instances.create({
      projectId: target.id,
      app: "docs",
      env: "production",
    });
    const theirs = await ctx.probe.instances.create({
      projectId: source.id,
      app: "docs",
      env: "production",
    });

    const dry = await ctx.merge.merge(source.id, target.id, { dryRun: true });

    const deploy = dry.steps.find((step) => step.name === "deploy")!;
    expect(deploy.conflicts).toEqual([
      expect.objectContaining({
        kind: "app instance",
        key: "docs / production",
        sourceId: theirs.id,
      }),
    ]);
    await expect(ctx.merge.merge(source.id, target.id)).rejects.toThrow(
      /app instance "docs \/ production"/,
    );
    expect((await ctx.probe.instances.findById(theirs.id))!.projectId).toBe(
      source.id,
    );
  });

  it("moves a sigil with its token, keeps the target's coverage day, and adds the capabilities the target lacks", async ({
    expect,
  }) => {
    const target = await createTestProject(ctx.alepha, {
      capabilities: [{ key: "work", options: { board: false } }],
    });
    const source = await createTestProject(ctx.alepha);
    const sigil = await ctx.probe.sigils.create({
      projectId: source.id,
      name: "lore/production",
      tokenHash: "hash",
      tokenPrefix: "sg_lore_",
    });
    const run = (projectId: number) =>
      ctx.probe.quality.create({
        projectId,
        day: "2026-10-27",
        commitSha: "abcdef1",
        branch: "main",
        coverageLines: 80,
        coverageStatements: 80,
        coverageFunctions: 80,
        coverageBranches: 80,
        testsTotal: 1,
        testsPassed: 1,
        testsFailed: 0,
        testsSkipped: 0,
        durationMs: 1,
      });
    const kept = await run(target.id);
    const dropped = await run(source.id);

    const plan = await ctx.merge.merge(source.id, target.id);

    const moved = (await ctx.probe.sigils.findById(sigil.id))!;
    expect(moved.projectId).toBe(target.id);
    expect(moved.tokenHash).toBe("hash");
    expect(await ctx.probe.quality.findById(kept.id)).toBeDefined();
    expect(await ctx.probe.quality.findById(dropped.id)).toBeUndefined();
    const capabilities = await ctx.repos.capabilities.findMany({
      where: { projectId: { eq: target.id } },
    });
    expect(capabilities.map((row) => row.key).sort()).toEqual([
      "apps",
      "knowledge",
      "support",
      "work",
    ]);
    expect(capabilities.find((row) => row.key === "work")!.options).toEqual({
      board: false,
    });
    const changed = plan.steps.flatMap((step) => step.changed);
    expect(changed).toContainEqual(
      expect.objectContaining({ kind: "quality run", field: "dropped" }),
    );
    expect(changed).toContainEqual(
      expect.objectContaining({ kind: "capability", from: "work" }),
    );
  });

  it("adds the source's members to the target, never as owner", async ({
    expect,
  }) => {
    const target = await createTestProject(ctx.alepha);
    const source = await createTestProject(ctx.alepha);

    await ctx.merge.merge(source.id, target.id);

    const members = await ctx.probe.members.findMany({
      where: { organizationId: { eq: target.organizationId! } },
    });
    const ranks = Object.fromEntries(
      members.map((member) => [member.userId, member.rank]),
    );
    expect(ranks).toEqual({
      [target.createdBy]: "owner",
      [source.createdBy]: "member",
    });
  });
});
