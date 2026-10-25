import { ProjectController } from "@lore/core/api";
import { ProjectTools } from "@lore/core/mcp";
import { ReadCounter, TripCounter } from "@lore/core/testing";
import { FolioTools } from "@lore/knowledge/mcp";
import { EpicTools, QuestTools } from "@lore/work/mcp";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import {
  AlephaSecurity,
  ResourceGateMemoProvider,
  currentUserAtom,
} from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

/**
 * How many SEQUENTIAL database round trips each MCP read tool makes (#E76,
 * #Q2636).
 *
 * On the Worker every MCP call is a POST, pinned to the D1 primary, and a
 * statement the tool awaits before issuing the next costs a trip there: up
 * to ~90 ms from the US colos Claude's connector enters through (#F1362).
 * Statements issued together cost one. So the number that matters is the
 * longest chain, which `TripCounter` measures by holding every statement
 * for a fixed delay; `ReadCounter` counts statements, which is a different
 * question.
 *
 * A scenario: `project_context` and `folio_get` span Work and Knowledge.
 */
const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with({ provide: CronProvider, use: ManualCronProvider });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  bootLore(alepha, ["api", "mcp"]);
  alepha.with(ReadCounter);
  alepha.with(TripCounter);

  const trips = alepha.inject(TripCounter);
  const reads = alepha.inject(ReadCounter);
  const tools = {
    ...(alepha.inject(ProjectTools) as any),
    ...(alepha.inject(QuestTools) as any),
    ...(alepha.inject(EpicTools) as any),
    ...(alepha.inject(FolioTools) as any),
  };
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();
  trips.delayMs = 0;

  const owner = await users.createUser({ username: "owner" });

  const call = <R = any>(name: string, params: Record<string, unknown>) =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, {
        id: owner.id,
        roles: ["user"],
      } as never);
      alepha.context.set(
        ResourceGateMemoProvider.KEY,
        new Map<string, Promise<unknown>>(),
      );
      return tools[name].execute(params) as Promise<R>;
    });

  const project: any = await alepha.context.run(() => {
    alepha.store.set(currentUserAtom, {
      id: owner.id,
      roles: ["user"],
    } as never);
    return projectApi.createProject({ body: { title: "Trips" } } as any);
  });
  const p = { project: project.id };

  const first = await call("epic_create", {
    ...p,
    title: "First",
    description: "x",
  });
  const epic = await call("epic_create", {
    ...p,
    title: "Second",
    description: "y".repeat(2000),
    dependsOn_number: first.number,
  });
  await call("epic_set_status", { ...p, number: epic.number, status: "ready" });
  const before = await call("quest_create", {
    ...p,
    title: "Before",
    area: "core",
    description: "b",
    priority: "low",
  });
  const quest = await call("quest_create", {
    ...p,
    title: "Measured",
    area: "core",
    priority: "high",
    epic_number: epic.number,
    dependsOn_shortId: before.shortId,
    objectives: [
      { title: "one", completed: false },
      { title: "two", completed: false },
    ],
    description: "see [[#Q1]]",
  });
  await call("quest_comment_add", {
    ...p,
    shortId: quest.shortId,
    body: "hello",
  });
  const folio = await call("folio_create", {
    ...p,
    title: "Note",
    content: `about [[#Q${quest.shortId}]]`,
    summary: "s",
    epic_number: epic.number,
  });
  await call("folio_create", {
    ...p,
    title: "Pinned",
    content: "p",
    pinned: true,
  });

  // Every statement now costs a trip.
  trips.delayMs = 30;

  const measure = async (name: string, params: Record<string, unknown>) => {
    trips.reset();
    reads.reset();
    const result = await call(name, params);
    return {
      result,
      trips: trips.trips,
      statements: trips.statements,
      chain: trips.chain,
    };
  };

  return { alepha, measure, p, quest, before, epic, folio, owner };
};

describe("MCP read tools: sequential D1 trips", () => {
  // Each target is the trip count after #Q2636, measured cold for the
  // tool's own reads (the 30 s project and rank caches are warm, as they are
  // on every call but the first after a deploy). A count that goes up is a
  // read that started waiting on another one: `chain` names the tables per
  // trip, which is where to look.
  it("quest_get reads the quest once, then everything else in one step", async ({
    expect,
  }) => {
    const ctx = await setup();

    const byShortId = await ctx.measure("quest_get", {
      ...ctx.p,
      shortId: ctx.quest.shortId,
    });
    // Membership, the quest, then predecessor + epic + thread + roster +
    // files together. It was eight.
    expect(byShortId.chain).toHaveLength(3);
    expect(byShortId.result.dependsOn_shortId).toBe(ctx.before.shortId);
    expect(byShortId.result.epic?.number).toBe(ctx.epic.number);
    expect(byShortId.result.discussion.map((c: any) => c.body)).toEqual([
      "hello",
    ]);
    expect(byShortId.result.discussion[0].author).toBeDefined();

    // By id the gate reads the quest, then the membership, then the rest.
    const byId = await ctx.measure("quest_get", { id: ctx.quest.id });
    expect(byId.trips).toBeLessThanOrEqual(3);

    await ctx.alepha.stop();
  }, 60_000);

  it("project_context runs its sections beside the project read", async ({
    expect,
  }) => {
    const ctx = await setup();

    const m = await ctx.measure("project_context", ctx.p);
    // Membership, then the project and every section at once, then the
    // folio index's filed epics and their names. It was seven.
    expect(m.trips).toBe(4);
    expect(m.result.epics.map((e: any) => e.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(m.result.activeQuests).toEqual([]);
    expect(m.result.areas.map((a: any) => a.name)).toEqual(["core"]);
    expect(m.result.pinnedFolios.map((f: any) => f.title)).toEqual(["Pinned"]);
    const note = m.result.folios.items.find((f: any) => f.title === "Note");
    expect(note.epicNumber).toBe(ctx.epic.number);

    const info = await ctx.measure("project_info", ctx.p);
    // It was five.
    expect(info.trips).toBe(2);
    expect(info.result.areas.map((a: any) => a.name)).toEqual(["core"]);

    await ctx.alepha.stop();
  }, 60_000);

  it("quest_list reads its page and the epic refs together", async ({
    expect,
  }) => {
    const ctx = await setup();

    const m = await ctx.measure("quest_list", ctx.p);
    // Membership, then the page (the draft gate is a subquery of it) with
    // the epic refs, then the page's comment stats. It was five.
    expect(m.trips).toBe(3);
    expect(m.result.quests.map((q: any) => q.title).sort()).toEqual([
      "Before",
      "Measured",
    ]);
    const measured = m.result.quests.find((q: any) => q.title === "Measured");
    expect(measured.commentCount).toBe(1);
    expect(measured.epic.number).toBe(ctx.epic.number);

    await ctx.alepha.stop();
  }, 60_000);

  it("folio_get reads the folio once, its links and its epic together", async ({
    expect,
  }) => {
    const ctx = await setup();

    const m = await ctx.measure("folio_get", {
      ...ctx.p,
      shortId: ctx.folio.shortId,
    });
    // Membership, the folio, its links and filing, then the names of what
    // they point at. It was seven: the folio was read three times.
    expect(m.trips).toBe(4);
    expect(m.chain.flat().filter((t: string) => t === "folios")).toHaveLength(
      1,
    );
    expect(m.result.epic?.number).toBe(ctx.epic.number);
    expect(m.result.links.outbound.map((l: any) => l.shortId)).toEqual([
      ctx.quest.shortId,
    ]);

    const list = await ctx.measure("folio_list", ctx.p);
    expect(list.trips).toBe(4);
    expect(list.result.folios).toHaveLength(2);

    await ctx.alepha.stop();
  }, 60_000);

  it("epic_get reads its rollup and its folios beside each other", async ({
    expect,
  }) => {
    const ctx = await setup();

    const m = await ctx.measure("epic_get", {
      ...ctx.p,
      number: ctx.epic.number,
    });
    // Membership, the epic, then predecessor + rollup + filed links, then
    // the folios' names. It was six.
    expect(m.trips).toBe(4);
    expect(m.result.dependsOn_number).toBe(1);
    expect(m.result.progress.total).toBe(1);
    expect(m.result.folios.map((f: any) => f.title)).toEqual(["Note"]);

    await ctx.alepha.stop();
  }, 60_000);
});
