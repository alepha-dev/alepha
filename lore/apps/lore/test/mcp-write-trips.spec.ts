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
 * How many SEQUENTIAL database round trips each MCP write tool makes (#E76,
 * #Q2637): the main save, then the tail that follows it (link sync,
 * revision, audit, epic workflow), which runs concurrently since none of its
 * steps reads what another writes. `mcp-tool-trips.spec.ts` is the read half
 * and says why the trip is the unit.
 *
 * The epic here has no predecessor, and the measured quest none either, so
 * accepting it starts the epic and completing it completes the epic: the
 * longest tails these tools have.
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

  const epic = await call("epic_create", {
    ...p,
    title: "Second",
    description: "y".repeat(2000),
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

  // Keep the synthetic D1 wait above CPU scheduling noise from concurrent suites.
  // Exact trip-count assertions remain unchanged.
  trips.delayMs = 90;

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

describe("MCP write tools: sequential D1 trips", () => {
  it("quest_update runs its link sync and its audit together, and syncs only changed text", async ({
    expect,
  }) => {
    const ctx = await setup();
    const q = { ...ctx.p, shortId: ctx.quest.shortId };

    const renamed = await ctx.measure("quest_update", {
      ...q,
      title: "Renamed",
    });
    // No text changed, so no link sync: membership, the quest by shortId,
    // the gate's quest, the save, the audit's read and write.
    expect(renamed.chain.flat()).not.toContain("delete folio_links");
    expect(renamed.trips).toBeLessThanOrEqual(6);

    const edited = await ctx.measure("quest_update", {
      ...q,
      description: "now [[#Q1]] and [[#F1]]",
    });
    // It was ten.
    expect(edited.trips, JSON.stringify(edited.chain)).toBe(6);

    await ctx.alepha.stop();
  }, 60_000);

  it("quest_accept and quest_complete read the epic once and run their tail together", async ({
    expect,
  }) => {
    const ctx = await setup();
    const q = { ...ctx.p, shortId: ctx.quest.shortId };

    const accepted = await ctx.measure("quest_accept", q);
    // It was ten, the epic read twice.
    expect(accepted.trips).toBe(8);
    expect(
      accepted.chain.flat().filter((t: string) => t === "epics"),
    ).toHaveLength(1);

    const completed = await ctx.measure("quest_complete", {
      ...q,
      message: "done, see [[#Q1]]",
      waive: [
        { objectiveId: 0, reason: "r" },
        { objectiveId: 1, reason: "r" },
      ],
    });
    // It was sixteen, the epic read four times.
    expect(completed.trips).toBe(7);
    expect(
      completed.chain.flat().filter((t: string) => t === "epics"),
    ).toHaveLength(1);

    // And the epic did complete: its last open quest just did.
    const epic = await ctx.measure("epic_get", {
      ...ctx.p,
      number: ctx.epic.number,
    });
    expect(epic.result.status).toBe("completed");

    await ctx.alepha.stop();
  }, 60_000);

  it("folio_create reads nothing for its first revision, and folio_update runs its tail together", async ({
    expect,
  }) => {
    const ctx = await setup();

    const created = await ctx.measure("folio_create", {
      ...ctx.p,
      title: "Fresh",
      content: "x [[#Q1]]",
      summary: "s",
    });
    // It was twelve: no revision is read before the first one is written.
    expect(created.trips).toBe(7);
    expect(created.chain.flat()).not.toContain("folio_revisions");

    const updated = await ctx.measure("folio_update", {
      ...ctx.p,
      shortId: ctx.folio.shortId,
      content: "changed [[#Q2]]",
    });
    // It was fifteen.
    expect(updated.trips).toBe(8);
    expect(updated.result.content).toBe("changed [[#Q2]]");

    const history = await ctx.measure("folio_history", {
      ...ctx.p,
      shortId: ctx.folio.shortId,
    });
    expect(history.result.revisions.length).toBeGreaterThan(0);

    await ctx.alepha.stop();
  }, 60_000);
});
