import {
  EpicController,
  FeedbackCommentController,
  QuestController,
} from "@lore/plan/api";
import { ProjectErrorController, SigilIngestService } from "@lore/ship/api";
import { ApiKeyController } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * The automatic triggers of #Q4331: triage on feedback, a feedback comment
 * and a trusted error group; work-loose-quests on a new loose quest; work-epic
 * on an epic turned ready. End to end, the one hop of #Q4229: a member's
 * feedback starts triage, the quest triage files starts one loose run, and
 * nothing that run does starts a third job.
 */
describe("automatic triggers", () => {
  let w: AutomationWorld;
  beforeEach(async () => {
    w = await automationWorld();
    w.alepha.inject(DateTimeProvider).pause();
  });
  afterEach(async () => {
    await w.stop();
  });

  const set = (name: string, body: Record<string, unknown>) =>
    w.controller.updatePrompt.run(
      { params: { projectId: w.projectId, name }, body: body as never },
      { user: w.owner },
    );
  const agentJobs = () =>
    w.repos.jobs.findMany({ where: { kind: { eq: "agent" } } });
  const row = (name: string) =>
    w.repos.prompts.findOne({
      where: { projectId: { eq: w.projectId }, name: { eq: name } },
    });
  const memberToken = async () =>
    (
      await w.alepha
        .inject(ApiKeyController)
        .createApiKey.fetch({ body: { name: "member" } }, { user: w.owner })
    ).data.token;
  const fileQuest = (title: string, extra: Record<string, unknown> = {}) =>
    w.alepha.inject(QuestController).createQuest.run(
      {
        body: {
          projectId: w.projectId,
          title,
          description: title,
          area: "general",
          priority: "medium",
          ...extra,
        } as never,
      },
      { user: w.owner },
    );
  const setAlephaTriggers = async () => {
    await set("triage", {
      on: "event:feedback.created,feedback.commented,error.trusted",
      check: ["feedback", "errors"],
      // At once: this chain is about what starts what, not the window.
      settleSeconds: 0,
    });
    await set("work-loose-quests", {
      on: "event:quest.created",
      check: ["quests"],
      settleSeconds: 0,
    });
    await set("work-epic", { on: "event:epic.ready" });
  };

  it("leaves every built-in manual in a new project", async ({ expect }) => {
    const prompts = await w.controller.listPrompts.run(
      { params: { projectId: w.projectId } },
      { user: w.owner },
    );
    expect(prompts.items.length).toBeGreaterThan(0);
    expect(new Set(prompts.items.map((it) => it.on))).toEqual(
      new Set(["manual"]),
    );
  });

  it("goes from feedback to triage to one loose run, and no further", async ({
    expect,
  }) => {
    await setAlephaTriggers();

    await w.submit("The cart total is wrong");
    await w.drain();
    const [triage] = await agentJobs();
    expect(triage).toMatchObject({
      prompt: "triage",
      cause: { kind: "event", event: "feedback.created" },
    });

    // Triage files a quest with its own key: the one hop.
    const triageKey = await w.keyOf(triage!.id);
    const filed = await w.mcp(triageKey, "quest_create", {
      project: w.projectId,
      title: "Fix the cart total",
      area: "general",
      description: "The total ignores the discount.",
      priority: "medium",
    });
    expect(filed.result?.isError).toBeFalsy();
    await w.drain();
    const loose = (await agentJobs()).find(
      (it) => it.prompt === "work-loose-quests",
    );
    expect(loose).toMatchObject({
      cause: { kind: "event", event: "quest.created" },
      startedByJobId: triage!.id,
    });

    // What the loose run does starts nothing: its own quest, and a comment
    // on the feedback that would trigger triage a second time.
    const looseKey = await w.keyOf(loose!.id);
    await w.mcp(looseKey, "quest_create", {
      project: w.projectId,
      title: "Found while fixing the cart",
      area: "general",
      description: "A follow-up.",
      priority: "low",
    });
    await w.mcp(looseKey, "feedback_comment_add", {
      project: w.projectId,
      shortId: 1,
      body: "Fixed in the pull request.",
    });
    await w.drain();
    expect(await agentJobs()).toHaveLength(2);
    // The comment queued a triage behind the running one; once that one
    // ends, the chain refuses it: a third agent job of the chain.
    await w.finish(triage!.id);
    await w.drain();
    expect(await agentJobs()).toHaveLength(2);
    expect(await w.waiting()).toHaveLength(0);
  });

  it("starts no loose run for a quest under an epic, tagged needs-human or already taken, and records no skip", async ({
    expect,
  }) => {
    await setAlephaTriggers();
    const epic = await w.alepha
      .inject(EpicController)
      .createEpic.run(
        { params: { projectId: w.projectId }, body: { title: "Checkout" } },
        { user: w.owner },
      );
    const token = await memberToken();
    const filed = await w.mcp(token, "quest_create", {
      project: w.projectId,
      title: "Under the epic",
      description: "Part of the checkout epic.",
      area: "general",
      priority: "medium",
      epic_number: epic.number,
    });
    expect(JSON.stringify(filed)).not.toContain('"isError":true');
    await fileQuest("Decide the pricing", { tags: ["needs-human"] });
    // Filed and accepted in one call, as a session files its own work.
    const taken = await w.mcp(token, "quest_create", {
      project: w.projectId,
      title: "Taken at once",
      description: "Mine.",
      area: "general",
      priority: "medium",
      accept: true,
    });
    expect(JSON.stringify(taken)).not.toContain('"isError":true');
    await w.drain();
    expect(await agentJobs()).toEqual([]);
    expect((await row("work-loose-quests"))?.lastSkippedReason).toBeFalsy();

    await fileQuest("Fix the login");
    await w.drain();
    const jobs = await agentJobs();
    expect(jobs.map((it) => it.prompt)).toEqual(["work-loose-quests"]);
  });

  it("starts work-epic once per epic turned ready, with the epic as its arg", async ({
    expect,
  }) => {
    await setAlephaTriggers();
    const epics = w.alepha.inject(EpicController);
    for (const title of ["Checkout", "Search"]) {
      const epic = await epics.createEpic.run(
        { params: { projectId: w.projectId }, body: { title } },
        { user: w.owner },
      );
      await epics.setEpicStatus.run(
        { params: { id: epic.id }, body: { status: "ready" } },
        { user: w.owner },
      );
    }
    await w.drain();
    const jobs = await agentJobs();
    expect(jobs.map((it) => it.prompt)).toEqual(["work-epic", "work-epic"]);
    expect(
      jobs
        .map((it) => it.args?.[0]?.title)
        .sort((a, b) => a!.localeCompare(b!)),
    ).toEqual(["Checkout", "Search"]);
    expect(jobs.map((it) => it.cause)).toEqual([
      { kind: "event", event: "epic.ready" },
      { kind: "event", event: "epic.ready" },
    ]);
  });

  it("starts triage on a feedback comment", async ({ expect }) => {
    await set("triage", {
      on: "event:feedback.commented",
      settleSeconds: 0,
    });
    const item = await w.submit("The save button fails");
    await w.drain();
    expect(await agentJobs()).toEqual([]);

    await w.alepha
      .inject(FeedbackCommentController)
      .createFeedbackComment.run(
        { params: { id: item.id }, body: { body: "It fails on Safari only." } },
        { user: w.owner },
      );
    await w.drain();
    expect((await agentJobs()).map((it) => it.cause)).toEqual([
      { kind: "event", event: "feedback.commented" },
    ]);
  });

  it("starts triage once per error group trusted, never per occurrence", async ({
    expect,
  }) => {
    await set("triage", {
      on: "event:error.trusted",
      check: ["errors"],
      settleSeconds: 0,
    });
    const sigil = await w.repos.sigils.create({
      projectId: w.projectId,
      name: "acme/production",
      tokenHash: "hash-chain",
      tokenPrefix: "sg_chain",
      kinds: ["errors"],
    });
    const ingest = w.alepha.inject(SigilIngestService);
    const report = (origin: "client" | "server", frame: string) =>
      ingest.absorb(sigil, {
        errors: [
          {
            name: "TypeError",
            message: `x is undefined in ${frame}`,
            stack: `TypeError: x\n    at ${frame} (app.js:1:1)`,
            sourceUrl: "/api/cart",
            origin,
          },
        ],
      } as never);
    const events = () =>
      w.repos.events.findMany({ where: { name: { eq: "error.trusted" } } });

    // A new server group is trusted on arrival: one event, one run.
    await report("server", "total");
    await report("server", "total");
    await w.drain();
    expect(await events()).toHaveLength(1);
    expect(await agentJobs()).toHaveLength(1);

    // A browser group waits for a member, whose trust is the event.
    await report("client", "render");
    expect(await events()).toHaveLength(1);
    const [browser] = await w.repos.errors.findMany({
      where: { origin: { eq: "client" } },
    });
    await w.alepha
      .inject(ProjectErrorController)
      .trustProjectError.run(
        { params: { projectId: w.projectId, errorId: browser!.id } },
        { user: w.owner },
      );
    const recorded = await events();
    expect(recorded).toHaveLength(2);
    expect(recorded.map((it) => it.fields.trusted_by)).toEqual([
      undefined,
      w.owner.id,
    ]);
  });
});
