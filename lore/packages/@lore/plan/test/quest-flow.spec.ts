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
  QuestDraftService,
  QuestFlowHistory,
  QuestFlowService,
  ReleaseForecast,
} from "../src/api/index.ts";
import { ProjectFlowReportService } from "../src/api/services/ProjectFlowReportService.ts";
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

  /**
   * The draft state (#Q4377): below every other state, above to do.
   */
  describe("draft", () => {
    it("reads a quest born draft as a draft from its creation", ({
      expect,
    }) => {
      const quest = { ...base, draftAt: at(0) };

      expect(history.stateAt(quest, t0 - day)).toBeUndefined();
      expect(history.stateAt(quest, t0 + day)).toBe("draft");
      expect(history.stateAt(quest, t0 + 30 * day)).toBe("draft");
    });

    it("reads a quest its epic released as a draft until readyAt", ({
      expect,
    }) => {
      // Backfilled under a draft epic, then the epic was marked ready on
      // day 2: `draftAt` cleared, `readyAt` stamped.
      const quest = {
        ...base,
        readyAt: at(2),
        acceptedAt: at(3),
        completedAt: at(5),
      };

      expect(history.stateAt(quest, t0 + day)).toBe("draft");
      expect(history.stateAt(quest, t0 + 2.5 * day)).toBe("todo");
      expect(history.stateAt(quest, t0 + 4 * day)).toBe("inProgress");
      expect(history.stateAt(quest, t0 + 6 * day)).toBe("done");
    });

    it("never reads a quest that was never drafted as a draft", ({
      expect,
    }) => {
      const quest = { ...base, acceptedAt: at(2) };

      expect(history.stateAt(quest, t0 + day)).toBe("todo");
      expect(history.stateAt(quest, t0 + 3 * day)).toBe("inProgress");
    });

    it("reads a to-do quest drafted later as to do before that", ({
      expect,
    }) => {
      const quest = { ...base, draftAt: at(2) };

      expect(history.stateAt(quest, t0 + day)).toBe("todo");
      expect(history.stateAt(quest, t0 + 3 * day)).toBe("draft");
    });

    it("lets every other state win over a draft", ({ expect }) => {
      // A held or shelved quest of a draft epic carries `draftAt` too.
      const draft = { ...base, draftAt: at(0) };

      expect(history.stateAt({ ...draft, heldAt: at(1) }, t0 + 2 * day)).toBe(
        "onHold",
      );
      expect(
        history.stateAt({ ...draft, shelvedAt: at(1) }, t0 + 2 * day),
      ).toBeUndefined();
      expect(
        history.stateAt(
          { ...base, readyAt: at(3), completedAt: at(1) },
          t0 + 2 * day,
        ),
      ).toBe("done");
    });

    it("loses the first release of a quest drafted twice, a known gap", ({
      expect,
    }) => {
      // Released on day 2, drafted again on day 4, released on day 6: only
      // the last release is stored.
      const released = { ...base, readyAt: at(6) };
      // While drafted the second time, `draftAt` and the first release say
      // it all.
      const drafted = { ...base, readyAt: at(2), draftAt: at(4) };

      expect(history.stateAt(released, t0 + 3 * day)).toBe("draft");
      expect(history.stateAt(released, t0 + 7 * day)).toBe("todo");
      expect(history.stateAt(drafted, t0 + day)).toBe("draft");
      expect(history.stateAt(drafted, t0 + 3 * day)).toBe("todo");
      expect(history.stateAt(drafted, t0 + 5 * day)).toBe("draft");
    });
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
      key: "plan",
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
      alepha,
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

  it("answers no point for an empty axis, without reading the snapshot", async ({
    expect,
  }) => {
    const { flow, projectId, quest } = await setup();
    await quest({});

    // An axis is empty when its range ends before it starts. Its bounds
    // would be undefined, which a where-filter refuses.
    expect(await flow.points(projectId, [], {})).toEqual([]);
    expect(await flow.points(projectId, [], { tag: "bug" })).toEqual([]);
  });

  it("gives the flow report an empty series when from is after to", async ({
    expect,
  }) => {
    const { alepha, projectId, quest, iso } = await setup();
    await quest({ createdAt: iso(5) });

    const report = await alepha
      .inject(ProjectFlowReportService)
      .report(projectId, { from: iso(1), to: iso(3) });

    expect(report.cumulative).toEqual([]);
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

  it("counts an open quest of a draft epic as a draft on the project, area and epic rows", async ({
    expect,
  }) => {
    const { flow, repos, projectId, quest, iso, days } = await setup();
    const draft = await repos.epics.create({
      projectId,
      number: 1,
      title: "Draft",
      description: "",
      status: "draft",
    });
    // A draft epic's quest as the epic writes it: a draft.
    await quest({ epicId: draft.id, createdAt: iso(3), draftAt: iso(3) });
    await quest({ createdAt: iso(3) });
    const [today] = days(0);

    await flow.snapshot(projectId, today!);

    const rows = await repos.questFlowDaily.findMany({
      where: { projectId: { eq: projectId } },
    });
    const byDimension = Object.fromEntries(
      rows.map((row) => [row.dimension, [row.draft, row.todo]]),
    );
    expect(byDimension).toEqual({
      project: [1, 1],
      area: [1, 1],
      epic: [1, 0],
    });
  });

  it("puts a quest released by its epic in the draft band before its release only", async ({
    expect,
  }) => {
    const { alepha, flow, repos, projectId, quest, iso, days } = await setup();
    const epic = await repos.epics.create({
      projectId,
      number: 1,
      title: "Draft",
      description: "",
      status: "draft",
    });
    const released = await quest({
      epicId: epic.id,
      createdAt: iso(5),
      draftAt: iso(5),
    });
    await alepha.inject(QuestDraftService).releaseEpic(epic.id);
    await repos.quests.updateById(released.id, { readyAt: iso(2) });
    const [before, after] = days(3, 1);

    const points = await flow.points(projectId, [before!, after!], {});

    expect(points.map((point) => [point.draft, point.todo])).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("reads a snapshot row written before drafts were counted as none", async ({
    expect,
  }) => {
    const { flow, repos, projectId, days } = await setup();
    const [recent] = days(1);
    await repos.questFlowDaily.create({
      projectId,
      day: recent!,
      dimension: "project",
      subject: "",
      todo: 3,
      inProgress: 0,
      onHold: 0,
      done: 0,
    });

    const [point] = await flow.points(projectId, [recent!], {});

    expect(point).toMatchObject({ draft: 0, todo: 3, exact: true });
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
