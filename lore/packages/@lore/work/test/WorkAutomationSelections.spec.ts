import { Alepha } from "alepha";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreWorkApi } from "../src/api/index.ts";
import { WorkAutomationSelections } from "../src/api/services/WorkAutomationSelections.ts";
import {
  createTestProject,
  createTestQuest,
  WorkTestEntities,
} from "../src/testing/index.ts";

/**
 * The quest tag selection. `quests.tags` is JSON text on SQLite and `text[]`
 * on Postgres, so the predicate is written per dialect; this suite runs on
 * SQLite, and the Postgres branch is the ORM's own `arrayContains`.
 */
describe("WorkAutomationSelections", () => {
  let alepha: Alepha;
  let selections: WorkAutomationSelections;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    }).with(LoreWorkApi);
    selections = alepha.inject(WorkAutomationSelections);
    alepha.inject(WorkTestEntities);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  type Input = Parameters<WorkAutomationSelections["select"]>[0];
  const run = (input: Partial<Input>, reminders: boolean) =>
    (
      selections as unknown as {
        select: WorkAutomationSelections["select"];
      }
    ).select(
      {
        filters: {},
        evaluatedAt: new Date().toISOString(),
        ...input,
      } as Input,
      reminders,
    );
  const select = (projectId: number, tag: string) =>
    run({ projectId, filters: { tag } }, false);

  it("selects only the open quests carrying the tag, matched case-insensitively", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    await createTestQuest(alepha, project, {
      title: "Tagged",
      tags: ["nightly", "infra"],
    });
    await createTestQuest(alepha, project, {
      title: "Other tag",
      tags: ["infra"],
    });
    await createTestQuest(alepha, project, { title: "Untagged" });

    const result = await select(project.id, " Nightly ");

    expect(result.items.map((item) => item.title)).toEqual(["Tagged"]);
    expect(result.totalIsExact).toBe(true);
  });

  it("pages due reminders by (due, shortId) without skipping or repeating a quest", async ({
    expect,
  }) => {
    const project = await createTestProject(alepha);
    const at = new Date(Date.now() - 60_000).toISOString();
    const later = new Date(Date.now() - 30_000).toISOString();
    // 52 due at the same instant, so the page boundary falls inside a tie,
    // and one due later, after them all.
    for (let index = 0; index < 52; index++)
      await createTestQuest(alepha, project, {
        acceptedAt: at,
        acceptedBy: project.createdBy,
        reminderInterval: "daily",
        reminderNextAt: at,
      });
    await createTestQuest(alepha, project, {
      title: "Last",
      acceptedAt: at,
      acceptedBy: project.createdBy,
      reminderInterval: "daily",
      reminderNextAt: later,
    });

    const first = await run({ projectId: project.id }, true);
    expect(first.items).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    const second = await run(
      { projectId: project.id, cursor: first.next as Input["cursor"] },
      true,
    );

    const seen = [...first.items, ...second.items].map((item) => item.shortId);
    expect(new Set(seen).size).toBe(53);
    expect(second.items.at(-1)?.title).toBe("Last");
    expect(second.hasMore).toBe(false);
  });
});
