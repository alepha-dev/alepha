import { AlephaLoreCli } from "@alepha/lore/cli";
import { Alepha, AlephaError } from "alepha";
import { ApiKeyController } from "alepha/api/keys";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * `lore automation` against a real Lore over HTTP, with a real API key
 * (#Q4231): created from the CLI, read by the page's own list action, run,
 * and its job read back with `lore job get`.
 */
describe("lore automation, against Lore", () => {
  let w: AutomationWorld;
  let cli: Alepha;
  let out: MemoryOutputProvider;
  let token: string;

  beforeEach(async () => {
    w = await automationWorld();
    const key = await w.alepha
      .inject(ApiKeyController)
      .createApiKey.fetch({ body: { name: "automations" } }, { user: w.owner });
    token = key.data.token;
    const project = await w.entities.projects.getOne({
      where: { id: { eq: w.projectId } },
    });
    cli = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: key.data.token,
        LORE_URL: w.baseUrl,
        LORE_PROJECT: project.slug ?? String(project.id),
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
      .with(AlephaLoreCli);
    out = cli.inject(MemoryOutputProvider);
  });
  afterEach(async () => {
    await cli.stop();
    await w.stop();
  });

  const run = async (path: string, argv: string[] = []): Promise<string> => {
    const [subject, ...verbs] = path.split(" ");
    let found = cli
      .primitives<any>("$command")
      .find((it) => it.name === subject && it.hasChildren);
    for (const verb of verbs) {
      found = found?.children.find((it: any) => it.name === verb);
    }
    if (!found) throw new AlephaError(`No command ${path}`);
    out.clear();
    await cli.inject(CliProvider).run(found, { argv, root: "/work" });
    return out.text;
  };

  it("creates, lists, updates, runs and pauses an automation, and its job reads back", async ({
    expect,
  }) => {
    expect(
      await run("automation create", [
        "nightly",
        "--text",
        "Summarise the week",
        "--on",
        "daily@7",
      ]),
    ).toContain("Created automation nightly: text on daily@7 UTC");

    // What the page reads.
    const { items } = await w.controller.listProjectAutomations.run(
      { params: { projectId: w.projectId } },
      { user: w.owner },
    );
    expect(items[0]).toMatchObject({
      name: "nightly",
      promptKind: "text",
      trigger: "schedule",
      schedule: "daily",
      dailyHour: 7,
    });
    expect(items[0]?.nextRunAt).toMatch(/T07:00:00\.000Z$/);

    expect(
      await run("automation update", [
        "nightly",
        "--on",
        "event:quest.created",
        "--settle-seconds",
        "30",
      ]),
    ).toContain("text on event:quest.created");
    expect(await run("automation disable", ["nightly"])).toContain(
      "Disabled automation nightly",
    );
    expect(await run("automation list")).toContain("(disabled)");

    const started = await run("automation run", ["nightly"]);
    expect(started).toContain("Started 1 job(s)");
    const [job] = await w.repos.jobs.findMany({
      where: { kind: { eq: "agent" } },
    });
    expect(job?.automationId).toBe(items[0]?.id);
    expect(await run("job get", [job!.id])).toContain("auto-nightly");

    expect(await run("automation pause-all")).toContain("Paused");
    expect(await run("automation settings")).toContain("Paused since");
    expect(await run("automation resume-all")).toContain("Resumed");
    expect(
      await run("automation settings", ["--builds-per-day", "5"]),
    ).toContain("at most 5 builds a day");

    expect(await run("automation delete", ["nightly"])).toContain(
      "Deleted automation nightly",
    );
    expect(await run("automation list")).toContain("no agent automation");
  });

  it("answers the same over MCP, no wider than the CLI", async ({ expect }) => {
    const created = await w.mcp(token, "automation_create", {
      project: w.projectId,
      name: "triage",
      prompt: "triage",
      on: "event:feedback.created",
      only_if_work: true,
    });
    expect(created.result?.isError).not.toBe(true);
    const listed = await w.mcp(token, "automation_list", {
      project: w.projectId,
    });
    const text = listed.result?.content?.[0]?.text ?? "";
    expect(text).toContain("event:feedback.created");
    const paused = await w.mcp(token, "automation_pause_all", {
      project: w.projectId,
    });
    expect(paused.result?.content?.[0]?.text ?? "").toContain("pausedAt");
  });
});
