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

  const select = (projectId: number, tag: string) =>
    (
      selections as unknown as {
        select: WorkAutomationSelections["select"];
      }
    ).select(
      {
        projectId,
        filters: { tag },
        evaluatedAt: new Date().toISOString(),
      } as Parameters<WorkAutomationSelections["select"]>[0],
      false,
    );

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
});
