import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import {
  LorePlanApi,
  QuestFlowHistory,
  QuestFlowService,
  ReleaseForecast,
} from "../src/api/index.ts";
import { WorkTestEntities } from "../src/testing/index.ts";

const day = 86_400_000;

/**
 * The flow history (#Q2998).
 */
describe("QuestFlowHistory", () => {
  const history = Alepha.create().inject(QuestFlowHistory);
  const t0 = Date.parse("2026-06-01T12:00:00.000Z");
  const at = (days: number) => new Date(t0 + days * day).toISOString();
  const base = { createdAt: at(0) };

  it("reads a quest through its lifecycle from its timestamps", ({
    expect,
  }) => {
    const quest = { ...base, acceptedAt: at(2), completedAt: at(4) };

    expect(history.stateAt(quest, t0 - day)).toBeUndefined();
    expect(history.stateAt(quest, t0 + day)).toBe("todo");
    expect(history.stateAt(quest, t0 + 3 * day)).toBe("inProgress");
    expect(history.stateAt(quest, t0 + 5 * day)).toBe("done");
  });

  it("puts a past hold back, from its events", ({ expect }) => {
    const quest = {
      ...base,
      acceptedAt: at(1),
      history: [
        { at: at(2), action: "held" as const },
        { at: at(3), action: "unheld" as const },
      ],
    };

    expect(history.stateAt(quest, t0 + 2.5 * day)).toBe("onHold");
    expect(history.stateAt(quest, t0 + 3.5 * day)).toBe("inProgress");
  });

  it("takes the hold in force from heldAt", ({ expect }) => {
    expect(history.stateAt({ ...base, heldAt: at(1) }, t0 + 2 * day)).toBe(
      "onHold",
    );
  });

  it("leaves a shelved quest out while it was shelved, not before", ({
    expect,
  }) => {
    const quest = { ...base, shelvedAt: at(2) };

    expect(history.stateAt(quest, t0 + day)).toBe("todo");
    expect(history.stateAt(quest, t0 + 3 * day)).toBeUndefined();
  });

  it("reads a quest handed back as to do again", ({ expect }) => {
    const quest = {
      ...base,
      history: [
        { at: at(1), action: "assigned" as const },
        { at: at(2), action: "unassigned" as const },
      ],
    };

    expect(history.stateAt(quest, t0 + 1.5 * day)).toBe("inProgress");
    expect(history.stateAt(quest, t0 + 3 * day)).toBe("todo");
  });

  it("measures time per board column up to the next move", ({ expect }) => {
    const times = history.columnTimes(
      [
        { at: at(0), action: "moved", column: "Doing" },
        { at: at(2), action: "moved", column: "Review" },
        { at: at(3), action: "moved", column: "Doing" },
      ],
      t0 + 4 * day,
    );

    expect(times.get("Doing")).toBe(3 * day);
    expect(times.get("Review")).toBe(day);
  });
});

describe("ReleaseForecast", () => {
  const forecast = new ReleaseForecast();

  it("needs no week for nothing left", ({ expect }) => {
    expect(forecast.weeks(0, [0, 0])).toEqual({ p50: 0, p85: 0 });
  });

  it("refuses to predict from a history with no completion", ({ expect }) => {
    expect(forecast.weeks(5, [0, 0, 0])).toBeUndefined();
  });

  it("reads a steady pace exactly", ({ expect }) => {
    expect(forecast.weeks(10, [5, 5, 5])).toEqual({ p50: 2, p85: 2 });
  });

  it("widens with a bursty pace of the same mean", ({ expect }) => {
    const bursty = forecast.weeks(20, [0, 0, 0, 20])!;

    expect(bursty.p85).toBeGreaterThan(bursty.p50);
  });

  it("gives the same dates for the same history", ({ expect }) => {
    expect(forecast.weeks(20, [1, 4, 0, 9])).toEqual(
      forecast.weeks(20, [1, 4, 0, 9]),
    );
  });
});

describe("QuestFlowService", () => {
  const setup = async () => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(LorePlanApi);
    const repos = alepha.inject(WorkTestEntities);
    await alepha.start();

    const user = await repos.users.create({
      username: "owner",
      email: "owner@example.com",
      roles: ["user"],
    });
    const organization = await repos.organizations.create({
      name: "org",
    });
    const project = await repos.projects.create({
      title: "Flow",
      slug: "flow",
      organizationId: organization.id,
      createdBy: user.id,
    });
    await repos.capabilities.create({
      projectId: project.id,
      key: "work",
      options: {},
    });

    let shortId = 0;
    const quest = (overrides: Record<string, unknown>) =>
      repos.quests.create({
        projectId: project.id,
        shortId: ++shortId,
        title: "q",
        description: "",
        area: "api",
        priority: "medium",
        createdBy: user.id,
        ...overrides,
      } as never);

    const now = alepha.inject(DateTimeProvider).nowMillis();
    const iso = (ago: number) => new Date(now - ago * day).toISOString();
    return {
      flow: alepha.inject(QuestFlowService),
      repos,
      projectId: project.id,
      quest,
      iso,
      days: (...ago: number[]) => ago.map((it) => iso(it).slice(0, 10)),
    };
  };

  it("writes a row for the project and the area, and a retry writes the same", async ({
    expect,
  }) => {
    const { flow, repos, projectId, quest, days } = await setup();
    await quest({});
    const [today] = days(0);

    await flow.snapshotAll(today!);
    await flow.snapshotAll(today!);

    const rows = await repos.questFlowDaily.findMany({
      where: { projectId: { eq: projectId } },
    });
    expect(rows.map((row) => row.dimension).sort()).toEqual([
      "area",
      "project",
    ]);
    expect(rows.every((row) => row.todo === 1)).toBe(true);
  });

  it("reads the snapshot where it exists and reconstructs before it", async ({
    expect,
  }) => {
    const { flow, repos, projectId, quest, iso, days } = await setup();
    await quest({ createdAt: iso(5) });
    const [old, recent] = days(4, 1);
    // A figure the reconstruction would never give: proof the row was read.
    await repos.questFlowDaily.create({
      projectId,
      day: recent!,
      dimension: "project",
      subject: "",
      todo: 7,
      inProgress: 0,
      onHold: 0,
      done: 0,
    });

    const points = await flow.points(projectId, [old!, recent!], {});

    expect(points.map((point) => [point.todo, point.exact])).toEqual([
      [1, false],
      [7, true],
    ]);
  });

  it("reconstructs a query no snapshot can answer", async ({ expect }) => {
    const { flow, repos, projectId, quest, iso, days } = await setup();
    await quest({ createdAt: iso(5), tags: ["bug"] });
    await quest({ createdAt: iso(5) });
    const [recent] = days(1);
    await repos.questFlowDaily.create({
      projectId,
      day: recent!,
      dimension: "project",
      subject: "",
      todo: 7,
      inProgress: 0,
      onHold: 0,
      done: 0,
    });

    const [point] = await flow.points(projectId, [recent!], { tag: "bug" });

    expect(point).toMatchObject({ todo: 1, exact: false });
  });

  it("keeps an open quest of a draft epic out of the project row only", async ({
    expect,
  }) => {
    const { flow, repos, projectId, quest, days } = await setup();
    const draft = await repos.epics.create({
      projectId,
      number: 1,
      title: "Draft",
      description: "",
      status: "draft",
    });
    await quest({ epicId: draft.id });
    const [today] = days(0);

    await flow.snapshot(projectId, today!);

    const rows = await repos.questFlowDaily.findMany({
      where: { projectId: { eq: projectId } },
    });
    expect(rows.map((row) => row.dimension)).toEqual(["epic"]);
  });

  it("gives each board column its median", async ({ expect }) => {
    const { flow, projectId, quest, iso } = await setup();
    await quest({
      completedAt: iso(0),
      history: [
        {
          at: iso(2),
          by: "00000000-0000-4000-8000-000000000000",
          action: "moved",
          column: "Doing",
        },
      ],
    });

    const [column] = await flow.columnTimes(projectId, {});

    expect(column?.column).toBe("Doing");
    expect(column?.medianHours).toBeCloseTo(48);
  });
});
