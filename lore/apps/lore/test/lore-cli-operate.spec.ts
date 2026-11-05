import { AlephaLoreCli } from "@alepha/lore/cli";
import { ProjectController } from "@lore/core/api";
import { blights } from "@lore/deploy/schemas";
import { EpicController, FeedbackController } from "@lore/work/api";
import { Alepha, AlephaError, z } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import {
  CliProvider,
  type CommandError,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";

/**
 * The commands that closed `GAPS` in `mcp-cli-parity.spec.ts`, against the real
 * Lore app, over HTTP, with a real API key: feedback, blights, insights,
 * releases, deployed copies, sigils, artifacts, deploys, stacks, automations
 * and a project merge.
 *
 * The parity spec proves a command exists. This one proves it reaches its
 * action: `$client` resolves by name at run time, so a command calling an
 * action the key cannot see compiles, and fails only here.
 */
const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

class Rows {
  blights = $repository(blights);
}

interface TestContext {
  alepha: Alepha;
  hostname: string;
}

type TestUser = { id: string; roles: string[] };

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
  bootLore(alepha);
  alepha.inject(Rows);

  await alepha.start();

  return {
    alepha,
    hostname: alepha.inject(NodeHttpServerProvider).hostname,
  };
};

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

  const run = async (path: string, argv: string[] = []): Promise<string> => {
    out.clear();
    await cli.inject(CliProvider).run(command(path), { argv, root: "/work" });
    return out.text;
  };

  const json = async (path: string, argv: string[] = []) =>
    JSON.parse(await run(path, [...argv, "--output", "json"]));

  const fail = async (path: string, argv: string[] = []) => {
    out.clear();
    const error = await cli
      .inject(CliProvider)
      .run(command(path), { argv, root: "/work" })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    return error as CommandError | undefined;
  };

  return { cli, run, json, fail, fs };
};

describe("the rest of MCP, from the lore CLI, against Lore", () => {
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

  const createUser = async (): Promise<TestUser> => {
    const fake = ctx.alepha.inject(FakeProvider).generate(userDataSchema);
    const response = await ctx.alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, roles: ["user"] } },
        { user: adminUser },
      );
    return { id: response.data.id, roles: response.data.roles };
  };

  const ownProject = async (title = "Lore CLI ops", owner?: TestUser) => {
    const user = owner ?? (await createUser());
    const project = await ctx.alepha
      .inject(ProjectController)
      .createProject.fetch(
        {
          body: {
            title,
            capabilities: [
              {
                key: "work",
                options: { epics: true, releases: true, automations: true },
              },
              { key: "knowledge" },
              { key: "support" },
              { key: "apps", options: { track: true, deploy: true } },
            ],
          },
        },
        { user },
      );
    const key = await ctx.alepha
      .inject(ApiKeyController)
      .createApiKey.fetch({ body: { name: `lore cli ${title}` } }, { user });
    const lore = cliFor(ctx, key.data.token, project.data.slug);
    clis.push(lore.cli);
    return { owner: user, project: project.data, lore };
  };

  it("triages feedback: reads it, answers it, accepts one and rejects one", async () => {
    const { owner, project, lore } = await ownProject();
    const submit = (title: string) =>
      ctx.alepha.inject(FeedbackController).submitFeedback.fetch(
        {
          params: { projectId: project.id },
          body: { title, description: "It broke on my phone" },
        },
        { user: owner },
      );
    await submit("Wontfix request");
    await submit("Broken header");
    const { items } = await lore.json("feedback list");
    const first = items.find((it: any) => it.title === "Broken header");
    const second = items.find((it: any) => it.title === "Wontfix request");
    const ref = `P${first.shortId}`;

    expect(await lore.run("feedback list")).toContain(ref);

    await lore.run("feedback comment add", [
      ref,
      "--body",
      "Reproduced on Safari",
      "--as",
      "claude-code",
    ]);
    const read = await lore.json("feedback get", [ref]);
    expect(read.title).toBe("Broken header");
    expect(read.comments[0].source).toEqual({
      kind: "cli",
      client: "claude-code",
    });
    expect(await lore.run("feedback get", [ref])).toContain(
      "Reproduced on Safari",
    );

    await lore.run("feedback accept", [ref]);
    await lore.run("feedback reject", [`P${second.shortId}`]);
    expect(await lore.run("feedback list")).toContain("No feedback here.");
    expect(await lore.run("feedback list", ["--status", "accepted"])).toContain(
      ref,
    );

    const quest = await lore.json("quest create", [
      "--title",
      "Fix the header",
      "--area",
      "core",
      "--priority",
      "low",
      "--feedback",
      ref,
      "--due-at",
      "2030-01-02T03:04:05.000Z",
    ]);
    expect(quest.feedbackId).toBe(first.id);
    expect(quest.dueAt).toContain("2030-01-02");
  });

  it("triages blights, and reads insights", async () => {
    const { project, lore } = await ownProject();
    const rows = ctx.alepha.inject(Rows);
    const now = new Date().toISOString();
    const seed = (fingerprint: string) =>
      rows.blights.create({
        projectId: project.id,
        fingerprint,
        name: "TypeError",
        message: `boom ${fingerprint}`,
        firstSeenAt: now,
        lastSeenAt: now,
        count: 3,
        status: "open",
      });
    const resolved = await seed("one");
    const forwarded = await seed("two");

    const inbox = await lore.run("blight list");
    expect(inbox).toContain(`B${resolved.id}`);
    expect(inbox).toContain("boom two");

    await lore.run("blight resolve", [`B${resolved.id}`]);
    expect(await lore.run("blight list")).not.toContain(`B${resolved.id}`);
    expect(await lore.run("blight list", ["--include-resolved"])).toContain(
      `B${resolved.id}`,
    );

    const { questShortId } = await lore.json("blight forward", [
      `B${forwarded.id}`,
    ]);
    expect(await lore.run("quest get", [`Q${questShortId}`])).toContain(
      "boom two",
    );

    const insights = await lore.json("insights read", ["--range", "1d"]);
    expect(insights.range).toBe("1d");
    expect(await lore.run("insights read", ["--segment", "errors"])).toContain(
      "Errors:",
    );
  });

  it("walks a release from create to delete", async () => {
    const { owner, project, lore } = await ownProject();
    const epic = await ctx.alepha
      .inject(EpicController)
      .createEpic.fetch(
        { params: { projectId: project.id }, body: { title: "An epic" } },
        { user: owner },
      );

    await lore.run("releases create", ["--tag", "1.0.0", "--title", "One"]);
    await lore.run("releases create", ["--tag", "1.1.0"]);
    expect(await lore.run("releases list")).toContain("1.1.0");

    await lore.run("releases update", ["--tag", "1.1.0", "--title", "Next"]);
    expect((await lore.json("releases get", ["--tag", "1.1.0"])).title).toBe(
      "Next",
    );

    await lore.run("releases attach", [
      "--tag",
      "1.0.0",
      "--epic",
      `E${epic.data.number}`,
    ]);
    expect(await lore.run("releases get", ["--tag", "1.0.0"])).toContain(
      "An epic",
    );
    await lore.run("releases detach", [
      "--tag",
      "1.0.0",
      "--epic",
      `E${epic.data.number}`,
    ]);
    expect(await lore.run("releases get", ["--tag", "1.0.0"])).not.toContain(
      "An epic",
    );

    const quest = await lore.json("quest create", [
      "--title",
      "Ships in one",
      "--area",
      "core",
      "--priority",
      "low",
      "--release",
      "1.0.0",
    ]);
    expect(
      (await lore.json("releases get", ["--tag", "1.0.0"])).looseQuests,
    ).toHaveLength(1);
    await lore.run("quest update", [`Q${quest.shortId}`, "--release", ""]);
    expect(
      (await lore.json("releases get", ["--tag", "1.0.0"])).looseQuests,
    ).toHaveLength(0);

    await lore.run("releases set default", ["--tag", "1.1.0"]);
    expect(await lore.run("releases list")).toContain("open, default");
    await lore.run("releases set default", ["--clear"]);
    expect(await lore.run("releases list")).not.toContain("open, default");
    const neither = await lore.fail("releases set default");
    expect(neither?.message).toContain("--clear");

    await lore.run("releases publish", [
      "--tag",
      "1.0.0",
      "--title",
      "Shipped",
    ]);
    expect(await lore.run("releases list")).toContain("released");
    expect(
      await lore.run("releases changelog", ["--tag", "1.0.0", "--frozen"]),
    ).toContain("#");
    const refused = await lore.fail("releases changelog", ["--tag", "1.0.0"]);
    expect(refused?.message).toContain("already published");

    await lore.run("releases reopen", ["--tag", "1.0.0"]);
    expect(await lore.run("releases list")).not.toContain("released");

    const unconfirmed = await lore.fail("releases delete", ["--tag", "1.1.0"]);
    expect(unconfirmed?.message).toContain("--yes");
    await lore.run("releases delete", ["--tag", "1.1.0", "--yes"]);
    expect(await lore.run("releases list")).not.toContain("1.1.0");
  });

  it("tracks a deployed copy, mints its sigil, and reads what it deployed", async () => {
    const { lore } = await ownProject();
    const pair = ["--app", "acme", "--env", "staging"];

    await lore.run("apps instance create", pair);
    expect(await lore.run("apps instance list")).toContain("acme/staging");
    await lore.run("apps instance update", [
      ...pair,
      "--url",
      "https://acme.example.com",
    ]);
    expect((await lore.json("apps instance get", pair)).url).toBe(
      "https://acme.example.com",
    );
    const nothing = await lore.fail("apps instance update", pair);
    expect(nothing?.message).toContain("Nothing to update");

    const minted = await lore.json("sigil create", pair);
    expect(minted.token).toMatch(/^sg_/);
    const [sigil] = await lore.json("sigil list");
    expect(sigil.name).toBe("acme/staging");
    const rotated = await lore.json("sigil rotate", [sigil.id]);
    expect(rotated.token).not.toBe(minted.token);

    const unconfirmed = await lore.fail("sigil delete", [sigil.id]);
    expect(unconfirmed?.message).toContain("--yes");
    await lore.run("sigil delete", [sigil.id, "--yes"]);
    expect(await lore.run("sigil list")).toContain("no sigils");

    expect(await lore.run("artifacts list")).toContain("No artifacts.");
    const noBuild = await lore.fail("artifacts get", [
      "--app",
      "acme",
      "--tag",
      "1.0.0",
    ]);
    expect(noBuild?.message).toContain("No artifact tagged");

    const noRun = await lore.fail("deploy status", pair);
    expect(noRun?.message).toContain("never been deployed");
    const noTarget = await lore.fail("deploy status");
    expect(noTarget?.message).toContain("--deployment");

    const noStack = await lore.fail("stack get", ["--name", "nothing"]);
    expect(noStack?.message).toContain("nothing");

    const keep = await lore.fail("apps instance delete", pair);
    expect(keep?.message).toContain("--yes");
    await lore.run("apps instance delete", [...pair, "--yes"]);
    expect(await lore.run("apps instance list")).not.toContain("acme/staging");
  });

  it("writes, tests and deletes an automation, by the revision it read", async () => {
    const { owner, lore } = await ownProject();
    await lore.fs.writeFile(
      "/work/rule.json",
      JSON.stringify({
        version: 1,
        trigger: { kind: "event", event: "feedback.created" },
        select: null,
        guard: null,
        actions: [
          {
            kind: "notify",
            recipient: owner.id,
            channel: "inbox",
            title: "New feedback",
            text: "Something came in",
            category: "automations",
          },
        ],
      }),
    );

    expect(await lore.json("automation list")).toHaveProperty("items", []);
    expect(await lore.run("automation catalog")).toContain("feedback.created");

    const created = await lore.json("automation create", [
      "--title",
      "Tell me",
      "--rule",
      "@rule.json",
    ]);
    expect(created.enabled).toBe(false);
    expect(await lore.run("automation list")).toContain("Tell me");
    expect(await lore.run("automation get", [created.id])).toContain(
      "feedback.created",
    );

    const notJson = await lore.fail("automation update", [
      created.id,
      "--expected-revision",
      String(created.revision),
      "--title",
      "Renamed",
      "--rule",
      "{",
    ]);
    expect(notJson?.message).toContain("--rule is not JSON");
    const mixed = await lore.fail("automation update", [
      created.id,
      "--expected-revision",
      String(created.revision),
      "--title",
      "Renamed",
      "--enabled",
    ]);
    expect(mixed?.message).toContain("--enabled alone");

    const enabled = await lore.json("automation update", [
      created.id,
      "--expected-revision",
      String(created.revision),
      "--enabled",
    ]);
    expect(enabled.enabled).toBe(true);
    const stopped = await lore.json("automation update", [
      created.id,
      "--expected-revision",
      String(enabled.revision),
      "--no-enabled",
    ]);
    expect(stopped.enabled).toBe(false);

    const runs = await lore.json("automation runs", [created.id]);
    expect(runs.items[0].automationId).toBe(created.id);
    expect(await lore.run("automation test", [created.id])).toContain("{");
    expect(
      await lore.run("automation adoption preview", ["quest-reminders"]),
    ).toContain("{");

    await lore.run("automation variable set", [
      "THRESHOLD",
      "--variable",
      JSON.stringify({ value: { kind: "number", value: 5 } }),
    ]);
    const { items } = await lore.json("automation variable list");
    expect(items[0].key).toBe("THRESHOLD");
    expect(
      await lore.run("automation variable dependents", ["THRESHOLD"]),
    ).toContain("items");
    await lore.run("automation variable delete", [
      "THRESHOLD",
      "--id",
      items[0].id,
      "--version",
      String(items[0].version),
    ]);

    const unconfirmed = await lore.fail("automation delete", [
      created.id,
      "--expected-revision",
      String(stopped.revision),
    ]);
    expect(unconfirmed?.message).toContain("--yes");
    await lore.run("automation delete", [
      created.id,
      "--expected-revision",
      String(stopped.revision),
      "--yes",
    ]);
    expect(await lore.run("automation list")).toContain("no automations");
  });

  it("plans a project merge by default, and applies it only when told to", async () => {
    const { owner, project, lore } = await ownProject("Merge source");
    const target = await ownProject("Merge target", owner);
    const quest = await lore.json("quest create", [
      "--title",
      "Moves",
      "--area",
      "core",
      "--priority",
      "low",
    ]);

    const argv = ["--source", project.slug, "--target", target.project.slug];
    const plan = await lore.run("project merge", argv);
    expect(plan).toContain("Nothing was written");
    expect(await lore.run("quest get", [`Q${quest.shortId}`])).toContain(
      "Moves",
    );

    await lore.run("project merge", [...argv, "--no-dry-run"]);
    expect(await target.lore.run("quest list")).toContain("Moves");
  });

  it("updates what only the tool used to reach on a quest", async () => {
    const { lore } = await ownProject();
    const draft = await lore.json("epic create", ["--title", "A draft epic"]);
    const quest = await lore.json("quest create", [
      "--title",
      "A quest",
      "--area",
      "core",
      "--priority",
      "low",
      "--objective",
      "First",
      "--epic",
      `E${draft.number}`,
    ]);
    const ref = `Q${quest.shortId}`;

    expect(await lore.run("quest list")).not.toContain(ref);
    expect(await lore.run("quest list", ["--include-drafts"])).toContain(ref);
    expect(
      await lore.run("quest list", ["--include-drafts", "--search", "nothing"]),
    ).not.toContain(ref);

    const read = await lore.json("quest get", [ref]);
    const updated = await lore.json("quest update", [
      ref,
      "--due-at",
      "2030-01-02T03:04:05.000Z",
      "--objectives",
      JSON.stringify([{ ...read.objectives[0], title: "Reworded" }]),
    ]);
    expect(updated.dueAt).toContain("2030-01-02");
    expect(updated.objectives[0].title).toBe("Reworded");

    const cleared = await lore.json("quest update", [ref, "--due-at", ""]);
    expect(cleared.dueAt).toBeUndefined();

    const stale = await lore.fail("quest update", [
      ref,
      "--title",
      "Overwrites",
      "--expected-updated-at",
      read.updatedAt,
    ]);
    expect(stale?.message).toBeDefined();
    expect((await lore.json("quest get", [ref])).title).toBe("A quest");

    const noList = await lore.fail("quest update", [ref, "--objectives", "{}"]);
    expect(noList?.message).toContain("JSON array");

    await lore.run("folio create", [
      "--title",
      "Pinned note",
      "--summary",
      "A note everyone reads",
      "--content",
      "Hello",
      "--pinned",
    ]);
    expect(await lore.json("folio list")).toMatchObject([{ pinned: true }]);
  });
});
