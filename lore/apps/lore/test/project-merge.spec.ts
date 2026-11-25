import { ProjectMergeController, ProjectMergeService } from "@lore/core/api";
import { qualityRuns } from "@lore/core/schemas";
import { appInstances, sigils } from "@lore/ship/schemas";
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
  createTestFolio,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

/**
 * `alepha test --dialect postgres` moves this suite onto Postgres.
 */
const onPostgres = process.env.DATABASE_TEST_DIALECT === "postgres";

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
const NOT_MOVED: Record<string, string> = {
  // A night's counts of that project as it stood, with its epic and release
  // ids as subjects. They stay with the source: added to the target's own
  // nights they would double a day, and the merge renumbers those ids. The
  // target's flow reads its own rows and shows the merged quests from the
  // first snapshot after the merge.
  quest_flow_daily: "the source's history as it was",
  // One row per project (#Q3894): the merged project keeps the target's
  // alert thresholds, as it keeps the target's settings.
  project_thresholds: "the target's own thresholds stand",
  // A pushed commit's quest numbers (#E154), in the source's numbering. The
  // merge renumbers the source's quests, so moved they would name the wrong
  // quests in the target; left behind, the moved deployments read as unknown
  // until the next push records the commit in the target's numbering.
  commit_quest_sets: "the source's quest numbers, which the merge renumbers",
  // A host job ran for the project that started it (#Q3984), with that
  // project's key, prompt and subject: its record stays with the source.
  host_jobs: "the source's runs, as they ran",
  // A job key is pinned to the project it was minted for (#Q3995), and dies
  // with its job: moved, it would widen to the target.
  job_keys: "the source's keys, pinned to the source",
  // A project's AI budget for its agents (#Q4237): one row per project, so
  // the merged project keeps the target's, as it keeps its thresholds.
  chat_agent_budgets: "the target's own budget stands",
  // What the source's budget paid for (#Q4237), counted against the source:
  // moved, it would spend the target's budget for runs it never paid.
  chat_agent_charges: "the source's spending, against its own budget",
  // A run waiting behind one of the source's jobs (#Q4354): that job stays
  // with the source, and its end starts the waiting run there.
  prompt_queue: "the source's waiting runs, behind the source's jobs",
};
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

  // SQLite only on purpose: it lists tables from sqlite_master.
  it.skipIf(onPostgres)(
    "accounts for every table with a project_id, moved or left on purpose",
    async ({ expect }) => {
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
      const handled = new Set([
        ...ctx.merge.tables(),
        ...Object.keys(NOT_MOVED),
      ]);

      expect(scoped.filter((name) => !handled.has(name))).toEqual([]);
      expect(scoped.length).toBeGreaterThan(20);
    },
  );

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
      capabilities: [{ key: "plan", options: { releases: false } }],
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
      "activity",
      "plan",
      "prompts",
      "remember",
      "reports",
      "ship",
    ]);
    expect(capabilities.find((row) => row.key === "plan")!.options).toEqual({
      releases: false,
    });
    const changed = plan.steps.flatMap((step) => step.changed);
    expect(changed).toContainEqual(
      expect.objectContaining({ kind: "quality run", field: "dropped" }),
    );
    expect(changed).toContainEqual(
      expect.objectContaining({ kind: "capability", from: "plan" }),
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

  it("rewrites a folio's reference to a quest Work renumbered, and leaves one that kept its number", async ({
    expect,
  }) => {
    const target = await createTestProject(ctx.alepha);
    const source = await createTestProject(ctx.alepha);
    await createTestQuest(ctx.alepha, target, { shortId: 7 });
    const renumbered = await createTestQuest(ctx.alepha, source, {
      shortId: 7,
    });
    await createTestQuest(ctx.alepha, source, { shortId: 3 });
    const note = await createTestFolio(ctx.alepha, source, {
      shortId: 1,
      title: "Decision",
      content: "Done in [[#Q7]] after [[#Q3]].",
    });

    const plan = await ctx.merge.merge(source.id, target.id);

    const work = plan.steps.find((step) => step.name === "work")!;
    const to = work.renumbered.find((row) => row.id === renumbered.id)!.to;
    const folio = (await ctx.repos.folios.findById(note.id))!;
    expect(folio.content).toBe(`Done in [[#Q${to}]] after [[#Q3]].`);
    expect(folio.searchText).toContain(`[[#q${to}]]`);
    expect(
      plan.steps.find((step) => step.name === "knowledge")!.rewritten,
    ).toEqual({ folios: 1 });
  });

  it("answers a dry run by default to the owner of both projects, with the mapping as markdown", async ({
    expect,
  }) => {
    const target = await createTestProject(ctx.alepha, { title: "Alepha" });
    const source = await createTestProject(ctx.alepha, {
      title: "Lore",
      createdBy: target.createdBy,
    });
    await createTestQuest(ctx.alepha, target, { shortId: 2683 });
    const quest = await createTestQuest(ctx.alepha, source, {
      shortId: 2683,
    });
    const owner = { id: target.createdBy, roles: ["user"] };

    const result = await ctx.alepha
      .inject(ProjectMergeController)
      .mergeProject.fetch(
        { params: { id: source.id }, body: { target: target.id } },
        { user: owner },
      );

    expect(result.data.dryRun).toBe(true);
    expect(result.data.report).toContain("# Lore merged into Alepha");
    expect(result.data.report).toContain("| #Q2683 | [[#Q2684]] |");
    expect((await ctx.repos.quests.findById(quest.id))!.projectId).toBe(
      source.id,
    );
  });

  it("refuses a caller who owns the source but not the target", async ({
    expect,
  }) => {
    const target = await createTestProject(ctx.alepha);
    const source = await createTestProject(ctx.alepha);
    const owner = { id: source.createdBy, roles: ["user"] };

    await expect(
      ctx.alepha
        .inject(ProjectMergeController)
        .mergeProject.fetch(
          { params: { id: source.id }, body: { target: target.id } },
          { user: owner },
        ),
    ).rejects.toThrow(/project:delete/);
  });
});
