import { AlephaLoreCli } from "@alepha/lore/cli";
import { Alepha, AlephaError, z } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import {
  CliProvider,
  CommandError,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EpicController } from "../src/api/controllers/EpicController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * `lore project`, `lore quest` and `lore folio` against the real Lore app,
 * over HTTP, with a real API key.
 *
 * The commands are thin: every one is a few existing actions called through
 * `$client`. So what can be wrong is what only the real server shows: the
 * status filter that drops an unknown value silently, the default page size,
 * a refusal's sentence and status, whether `metadata.links` survives
 * serialization, and the partial write a status read cannot see coming.
 *
 * ⚠️ Two containers, as in `release-cli-publish.spec.ts`: the CLI's `$env`
 * resolves `LORE_URL` when its container is created, and the server's port is
 * only known once the server has started.
 */
const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

type TestUser = { id: string; roles: string[] };

interface TestContext {
  alepha: Alepha;
  hostname: string;
  adminUserController: AdminUserController;
  apiKeyController: ApiKeyController;
  projectController: ProjectController;
  epicController: EpicController;
  questController: QuestController;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();

  return {
    alepha,
    hostname: alepha.inject(NodeHttpServerProvider).hostname,
    adminUserController: alepha.inject(AdminUserController),
    apiKeyController: alepha.inject(ApiKeyController),
    projectController: alepha.inject(ProjectController),
    epicController: alepha.inject(EpicController),
    questController: alepha.inject(QuestController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (ctx: TestContext): Promise<TestUser> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createApiKey = async (
  ctx: TestContext,
  user: TestUser,
): Promise<string> => {
  const response = await ctx.apiKeyController.createApiKey.fetch(
    { body: { name: "lore cli" } },
    { user },
  );
  return response.data.token;
};

/**
 * The CLI's own container, holding the key the way a shell holds
 * `LORE_API_KEY`. Never started: `run()` needs no lifecycle, and a started
 * `CliProvider` would read vitest's argv.
 *
 * Commands are found by path, `quest create` or `quest objective set`,
 * because `list`, `get`, `create` and `set` are each declared more than once.
 */
const cliFor = (ctx: TestContext, token: string, project: string) => {
  const cli = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      LORE_API_KEY: token,
      LORE_URL: ctx.hostname,
      LORE_PROJECT: project,
      HOME: "/nonexistent",
    },
  })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
    .with(AlephaLoreCli);

  const out = cli.inject(MemoryOutputProvider);
  const fs = cli.inject(MemoryFileSystemProvider);

  const command = (path: string) => {
    const [subject, ...verbs] = path.split(" ");
    let found = cli
      .primitives<any>("$command")
      .find((it) => it.name === subject && it.hasChildren);
    for (const verb of verbs) {
      found = found?.children.find((it: any) => it.name === verb);
    }
    if (!found) {
      throw new AlephaError(`No command ${path}`);
    }
    return found;
  };

  /**
   * Run one command and hand back what it printed.
   */
  const run = async (path: string, argv: string[]): Promise<string> => {
    out.clear();
    await cli.inject(CliProvider).run(command(path), { argv, root: "/work" });
    return out.text;
  };

  /**
   * Run one command that must fail, and hand back the error and what it
   * printed before failing.
   */
  const fail = async (path: string, argv: string[]) => {
    out.clear();
    const error = await cli
      .inject(CliProvider)
      .run(command(path), { argv, root: "/work" })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    return { error: error as CommandError | undefined, stdout: out.text };
  };

  return { cli, run, fail, fs };
};

describe("lore project, quest and folio, against Lore", () => {
  let ctx: TestContext;
  const clis: Alepha[] = [];

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    for (const cli of clis.splice(0)) {
      await cli.stop();
    }
    await ctx.alepha.stop();
  });

  const ownProject = async (title = "Lore CLI") => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title } },
      { user: owner },
    );
    const lore = cliFor(ctx, await createApiKey(ctx, owner), project.data.slug);
    clis.push(lore.cli);
    return { owner, project: project.data, lore };
  };

  it("creates, reads, lists and completes a quest", async () => {
    const { project, lore } = await ownProject();

    const created = JSON.parse(
      await lore.run("quest create", [
        "--title",
        "Fix the parser",
        "--area",
        "core",
        "--priority",
        "high",
        "--tag",
        "bug",
        "--tag",
        "cli",
        "--objective",
        "Write the spec",
        "--description=- a body that starts like a flag",
        "--output",
        "json",
      ]),
    );
    expect(created.shortId).toBeGreaterThan(0);
    expect(created.tags).toEqual(["bug", "cli"]);
    expect(created.description).toBe("- a body that starts like a flag");

    const shown = await lore.run("quest get", [`Q${created.shortId}`]);
    expect(shown).toContain(`Quest:`);
    expect(shown).toContain(`Q${created.shortId}`);
    expect(shown).toContain("[ ] 0  Write the spec");

    const listed = JSON.parse(
      await lore.run("quest list", ["--status", "todo", "--output", "json"]),
    );
    expect(listed.content.map((it: any) => it.shortId)).toContain(
      created.shortId,
    );
    expect(listed.page.totalElements).toBe(1);

    const human = await lore.run("quest list", ["--tag", "bug"]);
    expect(human).toContain(`Q${created.shortId}  Fix the parser`);

    // A status the action would drop in silence, listing everything, is
    // refused before any request.
    const stale = await lore.fail("quest list", ["--status", "accepted"]);
    expect(stale.error?.message).toContain("Invalid flag");

    // Completing a quest nobody accepted is the server's refusal, in its own
    // words, and exits 1.
    const early = await lore.fail("quest complete", [String(created.shortId)]);
    expect(early.error?.exitCode).toBe(1);
    expect(early.error?.message).toContain(`Project ${project.slug}:`);

    const accepted = JSON.parse(
      await lore.run("quest create", [
        "--title",
        "Ship it",
        "--area",
        "core",
        "--priority",
        "low",
        "--accept",
        "--output",
        "json",
      ]),
    );
    expect(accepted.acceptedAt).toBeTruthy();

    expect(
      await lore.run("quest complete", [
        `#Q${accepted.shortId}`,
        "--message",
        "Done.",
      ]),
    ).toBe(`Completed Q${accepted.shortId} Ship it`);

    const done = JSON.parse(
      await lore.run("quest get", [
        String(accepted.shortId),
        "--output",
        "json",
      ]),
    );
    expect(done.metadata.status).toBe("completed");
    expect(done.completionMessage).toBe("Done.");
    expect(done.comments).toEqual([]);
  });

  /**
   * The loop this repository asks of every session, run from a shell: create,
   * accept, tick one objective, waive another, complete with a commit, read
   * it all back.
   */
  it("runs the whole work loop from the shell", async () => {
    const { lore } = await ownProject();
    const created = JSON.parse(
      await lore.run("quest create", [
        "--title",
        "The loop",
        "--area",
        "core",
        "--priority",
        "medium",
        "--objective",
        "Write the code",
        "--objective",
        "Walk it in the live app",
        "--output",
        "json",
      ]),
    );
    const ref = `Q${created.shortId}`;
    const [done, manual] = created.objectives;

    expect(await lore.run("quest accept", [ref])).toBe(
      `Accepted ${ref} The loop`,
    );

    // Ticking needs an in-progress quest, and an unknown id is refused with
    // the ids the quest has.
    const unknown = await lore.fail("quest objective set", [
      ref,
      "--objective",
      "9",
    ]);
    expect(unknown.error?.name).toBe("UsageError");
    expect(unknown.error?.message).toContain(`${done.id} (Write the code)`);

    expect(
      await lore.run("quest objective set", [
        ref,
        "--objective",
        String(done.id),
      ]),
    ).toBe(`Ticked objective ${done.id} of ${ref}: Write the code`);

    // A retry after a dropped response must not untick what it ticked:
    // `completeObjective` flips, so the command reads first.
    expect(
      await lore.run("quest objective set", [
        ref,
        "--objective",
        String(done.id),
      ]),
    ).toBe(`Objective ${done.id} of ${ref} is already ticked: Write the code`);

    const badWaive = await lore.fail("quest complete", [
      ref,
      "--waive",
      "no-equals-sign",
    ]);
    expect(badWaive.error?.name).toBe("UsageError");
    const badSha = await lore.fail("quest complete", [
      ref,
      "--commit",
      "not-a-sha",
    ]);
    expect(badSha.error?.name).toBe("UsageError");

    expect(
      await lore.run("quest complete", [
        ref,
        "--message",
        "Shipped.",
        "--waive",
        `${manual.id}=manual, the owner walks it`,
        "--commit",
        "1a2b3c4d",
      ]),
    ).toBe(`Completed ${ref} The loop`);

    const read = JSON.parse(
      await lore.run("quest get", [ref, "--output", "json"]),
    );
    expect(read.metadata.status).toBe("completed");
    expect(read.objectives.find((it: any) => it.id === done.id).completed).toBe(
      true,
    );
    expect(
      read.objectives.find((it: any) => it.id === manual.id).waivedReason,
    ).toBe("manual, the owner walks it");
    expect(read.commits.map((it: any) => it.sha)).toEqual(["1a2b3c4d"]);

    const human = await lore.run("quest get", [ref]);
    expect(human).toContain(`[x] ${done.id}  Write the code`);
    expect(human).toContain(
      `[-] ${manual.id}  Walk it in the live app (waived: manual, the owner walks it)`,
    );
  });

  it("updates only the fields it is given, and refuses when it is given none", async () => {
    const { lore } = await ownProject();
    const created = JSON.parse(
      await lore.run("quest create", [
        "--title",
        "Before",
        "--area",
        "core",
        "--priority",
        "low",
        "--tag",
        "old",
        "--output",
        "json",
      ]),
    );

    expect(
      await lore.run("quest update", [
        `Q${created.shortId}`,
        "--title",
        "After",
        "--tag",
        "new",
      ]),
    ).toBe(`Updated Q${created.shortId}: title, tags`);

    const after = JSON.parse(
      await lore.run("quest get", [`Q${created.shortId}`, "--output", "json"]),
    );
    expect(after.title).toBe("After");
    expect(after.tags).toEqual(["new"]);
    expect(after.priority).toBe("low");

    const nothing = await lore.fail("quest update", [`Q${created.shortId}`]);
    expect(nothing.error?.name).toBe("UsageError");
  });

  it("refuses before writing when the epic's status already says no", async () => {
    const { owner, project, lore } = await ownProject();
    const draft = await ctx.epicController.createEpic.fetch(
      { params: { projectId: project.id }, body: { title: "A draft epic" } },
      { user: owner },
    );

    const refused = await lore.fail("quest create", [
      "--title",
      "Too early",
      "--area",
      "core",
      "--priority",
      "low",
      "--epic",
      `E${draft.data.number}`,
      "--accept",
    ]);

    expect(refused.error?.exitCode).toBe(1);
    expect(refused.error?.message).toContain("Nothing written");
    expect(refused.stdout).toBe("");
    const quests = await ctx.questController.getQuests.fetch(
      { params: { projectId: project.id }, query: { includeDrafts: true } },
      { user: owner },
    );
    expect(quests.data.content).toHaveLength(0);
  });

  /**
   * The partial write a status read cannot see: the epic is ready, so the
   * attach goes through, but its predecessor is not completed, so the accept
   * is refused. The quest exists, stdout carries it, and the exit is 1.
   */
  it("prints what it created and exits 1 when the accept is refused after the write", async () => {
    const { owner, project, lore } = await ownProject();
    const first = await ctx.epicController.createEpic.fetch(
      { params: { projectId: project.id }, body: { title: "Comes first" } },
      { user: owner },
    );
    const second = await ctx.epicController.createEpic.fetch(
      {
        params: { projectId: project.id },
        body: { title: "Comes second", dependsOn: first.data.id },
      },
      { user: owner },
    );
    await ctx.epicController.setEpicStatus.fetch(
      { params: { id: second.data.id }, body: { status: "ready" } },
      { user: owner },
    );

    const partial = await lore.fail("quest create", [
      "--title",
      "Blocked",
      "--area",
      "core",
      "--priority",
      "low",
      "--epic",
      String(second.data.number),
      "--accept",
      "--output",
      "json",
    ]);

    const printed = JSON.parse(partial.stdout);
    expect(printed.shortId).toBeGreaterThan(0);
    expect(partial.error?.exitCode).toBe(1);
    expect(partial.error?.message).toContain(
      `Created Q${printed.shortId}, but did not accept it:`,
    );

    const stored = await ctx.questController.getQuestByShortId.fetch(
      { params: { projectId: project.id, shortId: printed.shortId } },
      { user: owner },
    );
    expect(stored.data.epicId).toBe(second.data.id);
    expect(stored.data.acceptedAt).toBeFalsy();
  });

  it("refuses a stranger's key with exit 4, naming the project", async () => {
    const { project } = await ownProject();
    const stranger = await createTestUser(ctx);
    const lore = cliFor(ctx, await createApiKey(ctx, stranger), project.slug);
    clis.push(lore.cli);

    const refused = await lore.fail("quest list", []);

    expect(refused.error?.exitCode).toBe(4);
    expect(refused.error?.message).toContain(`Project ${project.slug}:`);
  });

  it("exits 1 on a quest that does not exist", async () => {
    const { lore } = await ownProject();

    const missing = await lore.fail("quest get", ["Q999"]);

    expect(missing.error?.exitCode).toBe(1);
  });

  it("creates a folio from a file, filed under an epic, and reads it back with its links", async () => {
    const { owner, project, lore } = await ownProject();
    const epic = await ctx.epicController.createEpic.fetch(
      { params: { projectId: project.id }, body: { title: "Knowledge" } },
      { user: owner },
    );
    const quest = JSON.parse(
      await lore.run("quest create", [
        "--title",
        "Linked",
        "--area",
        "core",
        "--priority",
        "low",
        "--output",
        "json",
      ]),
    );
    await lore.fs.writeFile(
      "/work/plan.md",
      `## Plan\n\nSee [[#Q${quest.shortId}]].`,
    );

    const created = await lore.run("folio create", [
      "--title",
      "The plan",
      "--summary",
      "What we will do.",
      "--content",
      "@plan.md",
      "--epic",
      `E${epic.data.number}`,
    ]);
    expect(created).toMatch(/^Created F\d+ The plan, filed under E\d+$/);
    const shortId = Number(/F(\d+)/.exec(created)?.[1]);

    const folio = JSON.parse(
      await lore.run("folio get", [
        `F${shortId}`,
        "--links",
        "--output",
        "json",
      ]),
    );
    expect(folio.content).toBe(`## Plan\n\nSee [[#Q${quest.shortId}]].`);
    expect(folio.epicId).toBe(epic.data.id);
    expect(
      folio.metadata.links.outbound.map((it: any) => `${it.kind}${it.shortId}`),
    ).toEqual([`quest${quest.shortId}`]);

    const human = await lore.run("folio get", [String(shortId), "--links"]);
    expect(human).toContain("## Plan");
    expect(human).toContain(`Q${quest.shortId}  Linked`);

    const listed = await lore.run("folio list", [
      "--epic",
      String(epic.data.number),
    ]);
    expect(listed).toContain(`F${shortId}  The plan`);
  });

  it("lists the caller's projects and shows one with its areas", async () => {
    const { project, lore } = await ownProject("Project Info");
    await lore.run("quest create", [
      "--title",
      "Seed an area",
      "--area",
      "docs",
      "--priority",
      "low",
    ]);

    expect(await lore.run("project list", [])).toContain(project.slug);

    const info = JSON.parse(
      await lore.run("project info", ["--output", "json"]),
    );
    expect(info.slug).toBe(project.slug);
    expect(info.areas.map((area: any) => area.name)).toContain("docs");
    expect(info.rank).toBeTruthy();

    const human = await lore.run("project info", ["-p", project.slug]);
    expect(human).toContain("Rank:");
    expect(human).toContain("docs  (1 open of 1)");
  });
});
