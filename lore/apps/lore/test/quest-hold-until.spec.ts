import { HourlyChecks } from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { QuestController, QuestHoldLifts } from "@lore/plan/api";
import { Alepha } from "alepha";
import { JobQueueProvider } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class QuietQueue extends JobQueueProvider {
  public override async dispatch() {}
}

/**
 * A hold until a date (#Q4408): the hourly sweep lifts it once the day has
 * come, the quest back in To do whatever it was, with one line in its
 * discussion and no notification. A hold with no date is left alone.
 */
describe("Quest hold until a date", () => {
  let alepha: Alepha;
  let rows: TestEntityRepositories;
  let time: DateTimeProvider;
  let quests: QuestController;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  const lifts = () => alepha.inject(QuestHoldLifts);

  const quest = async (title: string) => {
    const created = await quests.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title,
          area: "api",
          priority: "medium",
        },
      },
      { user },
    );
    return created.data.id;
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        SERVER_PORT: 0,
        LOG_LEVEL: "silent",
        APP_SECRET: "a-spec-secret-that-is-not-the-default-one",
      },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: QuietQueue });
    bootLore(alepha);
    rows = alepha.inject(TestEntityRepositories);
    await alepha.start();
    time = alepha.inject(DateTimeProvider);
    time.pause();
    quests = alepha.inject(QuestController);
    project = await createTestProject(alepha);
    await createPresetRanks(alepha, project.id);
    await rows.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("stores the date on the hold, and lifting the hold by hand clears it", async ({
    expect,
  }) => {
    const id = await quest("Wait two weeks");
    const until = time.now().add(2, "week").toISOString();
    const held = await quests.holdQuest.fetch(
      { params: { id }, body: { reason: "Frozen for two weeks", until } },
      { user },
    );
    expect(held.data.heldUntil).toBe(until);
    expect(held.data.metadata.status).toBe("on_hold");

    const unheld = await quests.unholdQuest.fetch({ params: { id } }, { user });
    expect(unheld.data.heldUntil).toBeUndefined();
    expect((await rows.quests.getById(id)).heldUntil).toBeUndefined();
  });

  it("refuses a date that has already passed", async ({ expect }) => {
    const id = await quest("Back in time");
    await expect(
      quests.holdQuest.fetch(
        {
          params: { id },
          body: {
            reason: "Never mind",
            until: time.now().subtract(1, "hour").toISOString(),
          },
        },
        { user },
      ),
    ).rejects.toThrow(HttpError);
    expect((await rows.quests.getById(id)).heldAt).toBeUndefined();
  });

  it("lifts a dated hold once its day has come, back to To do and unassigned, with one line in the discussion", async ({
    expect,
  }) => {
    const id = await quest("Parked");
    await quests.acceptQuest.fetch({ params: { id } }, { user });
    await quests.holdQuest.fetch(
      {
        params: { id },
        body: {
          reason: "Frozen for a week",
          until: time.now().add(1, "week").toISOString(),
        },
      },
      { user },
    );

    // Not yet: the day has not come.
    expect(await lifts().run(time.now().add(6, "day").toISOString())).toEqual(
      [],
    );
    expect((await rows.quests.getById(id)).heldAt).toBeDefined();

    const now = time.now().add(1, "week").add(1, "hour").toISOString();
    const [first, second] = await Promise.all([
      lifts().run(now),
      lifts().run(now),
    ]);
    expect([...first, ...second]).toHaveLength(1);

    const row = await rows.quests.getById(id);
    expect(row.heldAt).toBeUndefined();
    expect(row.heldBy).toBeUndefined();
    expect(row.heldUntil).toBeUndefined();
    expect(row.acceptedAt).toBeUndefined();
    expect(row.acceptedBy).toBeUndefined();
    expect(row.history.map((entry) => entry.action).slice(-2)).toEqual([
      "unheld",
      "unassigned",
    ]);

    const resource = await quests.getQuestById.fetch(
      { params: { id } },
      { user },
    );
    expect(resource.data.metadata.status).toBe("todo");

    const comments = await rows.comments.findMany({
      where: { subjectType: { eq: "quest" }, subjectId: { eq: id } },
    });
    const lines = comments.filter(
      (comment) => comment.source?.client === QuestHoldLifts.CLIENT,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].body).toContain("back in To do");

    // A second tick finds nothing left to lift.
    expect(await lifts().run(now)).toEqual([]);
  });

  it("leaves a hold with no date alone, however long it has been", async ({
    expect,
  }) => {
    const id = await quest("Waiting on a credential");
    await quests.holdQuest.fetch(
      { params: { id }, body: { reason: "Waiting on a credential" } },
      { user },
    );
    expect(await lifts().run(time.now().add(365, "day").toISOString())).toEqual(
      [],
    );
    const row = await rows.quests.getById(id);
    expect(row.heldAt).toBeDefined();
    expect(row.heldUntil).toBeUndefined();
  });

  it("runs as a check of the hourly job", async ({ expect }) => {
    const id = await quest("Hourly");
    await quests.holdQuest.fetch(
      {
        params: { id },
        body: {
          reason: "One day",
          until: time.now().add(1, "day").toISOString(),
        },
      },
      { user },
    );
    const check = alepha
      .inject(HourlyChecks)
      .all()
      .find((it) => it.name === "quests.hold-lifts");
    expect(check).toBeDefined();
    await check!.run(time.now().add(2, "day").toISOString());
    expect((await rows.quests.getById(id)).heldAt).toBeUndefined();
  });
});
