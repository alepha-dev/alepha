import { $inject, Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { EpicWorkflowService } from "./EpicWorkflowService.ts";

/**
 * Every rule in every status, against real rows.
 *
 * The service is the single place the workflow's refusals are written, so
 * this is the single place their WORDING is pinned: the controllers that
 * call it are tested for the fact of a refusal, and this spec for what the
 * refusal says. An agent reads these strings and acts on them, which makes
 * the wording part of the contract rather than a detail of it.
 *
 * The two automatic transitions (#Q2223) are pinned here too, directly. That
 * the quest handlers call them, and in which order, is
 * `test/quest-epic-workflow.spec.ts`'s job.
 *
 * `TestEntityRepositories` is composed rather than extended, for the reason
 * `EpicVisibilityService.spec.ts` gives: the `createTest*` helpers inject
 * the same cached instance, and every FK target has to be registered before
 * `alepha.start()`.
 */
class TestApp {
  repos = $inject(TestEntityRepositories);
  workflow = $inject(EpicWorkflowService);
}

const setup = async () => {
  const alepha = Alepha.create({
    // Pinned, like every other lore spec: the ROOT vitest config points
    // DATABASE_URL at Postgres, which this app's SQLite provider rejects.
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  const app = alepha.inject(TestApp);
  await alepha.start();
  const project = await createTestProject(alepha);
  return { alepha, app, project };
};

const STAMP = "2026-09-04T00:00:00.000Z";

describe("EpicWorkflowService", () => {
  describe("assertQuestWorkable", () => {
    it("allows a quest with no epic, which is most of them", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const quest = await createTestQuest(alepha, project);

      await expect(
        app.workflow.assertQuestWorkable(quest, "accept"),
      ).resolves.toBeUndefined();
    });

    it("allows a quest whose epic is ready or in progress", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      for (const status of ["ready", "in_progress"] as const) {
        const epic = await createTestEpic(alepha, project, { status });
        const quest = await createTestQuest(alepha, project, {
          epicId: epic.id,
        });

        await expect(
          app.workflow.assertQuestWorkable(quest, "accept"),
        ).resolves.toBeUndefined();
      }
    });

    it("refuses a planned epic's quest without telling the agent to flip it", async ({
      expect,
    }) => {
      // Whether a spec is done is the owner's call. The refusal used to say
      // "Begin it first", and an agent read that as an instruction.
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      await expect(
        app.workflow.assertQuestWorkable(quest, "accept"),
      ).rejects.toThrow(
        `Cannot accept quest #Q${quest.shortId}: Epic #E${epic.number} is planned, and not ready for development yet.`,
      );
    });

    it("refuses a completed epic's quest and names the successor-epic route", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "completed",
      });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      await expect(
        app.workflow.assertQuestWorkable(quest, "complete"),
      ).rejects.toThrow(
        `Cannot complete quest #Q${quest.shortId}: Epic #E${epic.number} is completed. File this in a new epic.`,
      );
    });

    it("carries the caller's verb, so every action shares one message shape", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "completed",
      });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      for (const verb of [
        "accept",
        "assign",
        "complete",
        "unshelve",
        "unhold",
      ] as const) {
        await expect(
          app.workflow.assertQuestWorkable(quest, verb),
        ).rejects.toThrow(`Cannot ${verb} quest #Q${quest.shortId}:`);
      }
    });

    it("lets a planned or ready epic's quest be unshelved or unheld, since that edits an open plan", async ({
      expect,
    }) => {
      // Shelve and hold are allowed while the plan is open, so their
      // reversals have to be too.
      const { alepha, app, project } = await setup();
      for (const status of ["planned", "ready"] as const) {
        const epic = await createTestEpic(alepha, project, { status });
        const quest = await createTestQuest(alepha, project, {
          epicId: epic.id,
          shelvedAt: STAMP,
        });

        await expect(
          app.workflow.assertQuestWorkable(quest, "unshelve"),
        ).resolves.toBeUndefined();
        await expect(
          app.workflow.assertQuestWorkable(quest, "unhold"),
        ).resolves.toBeUndefined();
      }
    });

    /**
     * ⚠️ The predecessor gates the START, not `ready` (#Q2223). A whole chain
     * can be marked ready together; each epic opens when the one before it
     * completes. Accepting is what starts a ready epic, so that is what the
     * gate refuses.
     */
    it("refuses to start a ready epic while its predecessor is not completed, naming both", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const first = await createTestEpic(alepha, project, {
        status: "in_progress",
      });
      const second = await createTestEpic(alepha, project, {
        status: "ready",
        dependsOn: first.id,
      });
      const quest = await createTestQuest(alepha, project, {
        epicId: second.id,
      });

      await expect(
        app.workflow.assertQuestWorkable(quest, "accept"),
      ).rejects.toThrow(
        `Cannot accept quest #Q${quest.shortId}: Epic #E${second.number} depends on Epic #E${first.number}, which is not completed.`,
      );
      await expect(
        app.workflow.assertQuestWorkable(quest, "assign"),
      ).rejects.toThrow(`Cannot assign quest #Q${quest.shortId}:`);
      // A plan edit starts nothing, so the predecessor has no say in it.
      await expect(
        app.workflow.assertQuestWorkable(quest, "unshelve"),
      ).resolves.toBeUndefined();
    });

    it("starts a ready epic once its predecessor is completed, or gone", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const completed = await createTestEpic(alepha, project, {
        status: "completed",
      });
      const afterCompleted = await createTestEpic(alepha, project, {
        status: "ready",
        dependsOn: completed.id,
      });
      const deleted = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const afterDeleted = await createTestEpic(alepha, project, {
        status: "ready",
        dependsOn: deleted.id,
      });
      await app.repos.epics.deleteById(deleted.id);

      for (const epic of [afterCompleted, afterDeleted]) {
        const quest = await createTestQuest(alepha, project, {
          epicId: epic.id,
        });
        await expect(
          app.workflow.assertQuestWorkable(quest, "accept"),
        ).resolves.toBeUndefined();
      }
    });

    it("never gates an in-progress epic on its predecessor", async ({
      expect,
    }) => {
      // Evaluated at the start and only there: a predecessor recorded after
      // the epic started is an ordering statement, not a constraint.
      const { alepha, app, project } = await setup();
      const first = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const second = await createTestEpic(alepha, project, {
        status: "in_progress",
        dependsOn: first.id,
      });
      const quest = await createTestQuest(alepha, project, {
        epicId: second.id,
      });

      await expect(
        app.workflow.assertQuestWorkable(quest, "accept"),
      ).resolves.toBeUndefined();
    });

    it("allows a quest whose epic row is gone rather than refusing", async ({
      expect,
    }) => {
      // A soft-deleted epic keeps `quests.epicId` pointing at it (only a
      // physical delete fires the FK's SET NULL) and `findOne` respects
      // `deletedAt`, so the row reads as missing. A missing epic is a loose
      // quest, never a refusal.
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "completed",
      });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });
      await app.repos.epics.deleteById(epic.id);

      await expect(
        app.workflow.assertQuestWorkable(quest, "accept"),
      ).resolves.toBeUndefined();
    });
  });

  describe("assertPlanEditable", () => {
    it("allows every edit while the epic is planned or ready", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      for (const status of ["planned", "ready"] as const) {
        const epic = await createTestEpic(alepha, project, { status });
        const quest = await createTestQuest(alepha, project, {
          epicId: epic.id,
        });

        expect(() =>
          app.workflow.assertPlanEditable(epic, { kind: "add" }),
        ).not.toThrow();
        expect(() =>
          app.workflow.assertPlanEditable(epic, { kind: "remove", quest }),
        ).not.toThrow();
        expect(() =>
          app.workflow.assertPlanEditable(epic, { kind: "delete", quest }),
        ).not.toThrow();
      }
    });

    it("refuses adding to an in-progress epic and names both escape routes", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "in_progress",
      });

      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "add" }),
      ).toThrow(
        `Cannot add a quest: Epic #E${epic.number} is in progress. Its plan is frozen. File this in a new epic, or add an objective to a quest already in it.`,
      );
    });

    it("refuses adding to a completed epic", async ({ expect }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "completed",
      });

      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "add" }),
      ).toThrow(
        `Cannot add a quest: Epic #E${epic.number} is completed. File this in a new epic.`,
      );
    });

    it("refuses removing from or deleting inside an in-progress epic, naming shelve", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "in_progress",
      });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "remove", quest }),
      ).toThrow(
        `Cannot remove quest #Q${quest.shortId}: Epic #E${epic.number} is in progress. Its plan is frozen. Shelve it instead.`,
      );
      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "delete", quest }),
      ).toThrow(
        `Cannot delete quest #Q${quest.shortId}: Epic #E${epic.number} is in progress. Its plan is frozen. Shelve it instead.`,
      );
    });

    it("refuses removing from or deleting inside a completed epic", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "completed",
      });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "remove", quest }),
      ).toThrow(
        `Cannot remove quest #Q${quest.shortId}: Epic #E${epic.number} is completed.`,
      );
      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "delete", quest }),
      ).toThrow(
        `Cannot delete quest #Q${quest.shortId}: Epic #E${epic.number} is completed.`,
      );
    });

    /**
     * ⚠️ No carve-out. The review of epic #31 proposed letting a completed or
     * shelved quest re-file in any phase, since it carries no work; the owner
     * chose "freeze for now". A quest's own status never softens the rule.
     */
    it("refuses a completed or shelved quest the same way", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "in_progress",
      });
      const completed = await createTestQuest(alepha, project, {
        epicId: epic.id,
        completedAt: STAMP,
      });
      const shelved = await createTestQuest(alepha, project, {
        epicId: epic.id,
        shelvedAt: STAMP,
      });

      for (const quest of [completed, shelved]) {
        expect(() =>
          app.workflow.assertPlanEditable(epic, { kind: "remove", quest }),
        ).toThrow(/is in progress. Its plan is frozen/);
      }
    });
  });

  describe("assertQuestDeletable", () => {
    it("allows a loose quest and a planned or ready epic's quest", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const planned = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const ready = await createTestEpic(alepha, project, { status: "ready" });

      for (const quest of [
        await createTestQuest(alepha, project),
        await createTestQuest(alepha, project, { epicId: planned.id }),
        await createTestQuest(alepha, project, { epicId: ready.id }),
      ]) {
        await expect(
          app.workflow.assertQuestDeletable(quest),
        ).resolves.toBeUndefined();
      }
    });

    it("refuses inside an in-progress epic, through the same message", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "in_progress",
      });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      await expect(app.workflow.assertQuestDeletable(quest)).rejects.toThrow(
        `Cannot delete quest #Q${quest.shortId}: Epic #E${epic.number} is in progress. Its plan is frozen. Shelve it instead.`,
      );
    });
  });

  describe("assertManualEdge", () => {
    it("allows planned to ready and back, and nothing else", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const planned = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const ready = await createTestEpic(alepha, project, { status: "ready" });
      const started = await createTestEpic(alepha, project, {
        status: "in_progress",
      });
      const completed = await createTestEpic(alepha, project, {
        status: "completed",
      });

      expect(() =>
        app.workflow.assertManualEdge(planned, "ready"),
      ).not.toThrow();
      expect(() =>
        app.workflow.assertManualEdge(ready, "planned"),
      ).not.toThrow();
      expect(() => app.workflow.assertManualEdge(started, "ready")).toThrow(
        `Cannot move Epic #E${started.number} from in_progress to ready. Work has started and its plan is frozen. Shelve what will not be done, or create a new epic.`,
      );
      expect(() => app.workflow.assertManualEdge(completed, "planned")).toThrow(
        `Cannot move Epic #E${completed.number} from completed to planned. It is completed. Create a new epic that depends on it.`,
      );
    });
  });

  describe("startIfReady", () => {
    it("moves a ready epic to in_progress and stamps startedAt", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "ready" });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      // No default release in this project, so nothing is carried down.
      await expect(
        app.workflow.startIfReady(quest, undefined),
      ).resolves.toBeUndefined();

      const after = await app.repos.epics.getById(epic.id);
      expect(after.status).toBe("in_progress");
      expect(after.startedAt).toBeDefined();
    });

    it("writes nothing for a loose quest or an epic in any other status", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      await app.workflow.startIfReady(
        await createTestQuest(alepha, project),
        undefined,
      );

      for (const status of ["planned", "in_progress", "completed"] as const) {
        const epic = await createTestEpic(alepha, project, {
          status,
          startedAt: status === "planned" ? undefined : STAMP,
        });
        const quest = await createTestQuest(alepha, project, {
          epicId: epic.id,
        });
        const before = await app.repos.epics.getById(epic.id);

        await app.workflow.startIfReady(quest, undefined);

        const after = await app.repos.epics.getById(epic.id);
        expect(after.status).toBe(status);
        expect(after.updatedAt).toEqual(before.updatedAt);
      }
    });
  });

  describe("completeIfResolved", () => {
    it("completes an in-progress epic whose quests are all completed or shelved", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "in_progress",
        startedAt: STAMP,
      });
      const last = await createTestQuest(alepha, project, {
        epicId: epic.id,
        acceptedAt: STAMP,
        completedAt: STAMP,
      });
      await createTestQuest(alepha, project, {
        epicId: epic.id,
        shelvedAt: STAMP,
      });

      await app.workflow.completeIfResolved(last, undefined);

      const after = await app.repos.epics.getById(epic.id);
      expect(after.status).toBe("completed");
      expect(after.completedAt).toBeDefined();
      // The start date is history, and completing never touches it.
      expect(after.startedAt).toBe(STAMP);
    });

    it("leaves it in progress while any quest is open, an accepted one included", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "in_progress",
      });
      const resolved = await createTestQuest(alepha, project, {
        epicId: epic.id,
        completedAt: STAMP,
      });
      // "Open" is "neither completed nor shelved", not "not accepted".
      await createTestQuest(alepha, project, {
        epicId: epic.id,
        acceptedAt: STAMP,
      });

      await app.workflow.completeIfResolved(resolved, undefined);

      expect((await app.repos.epics.getById(epic.id)).status).toBe(
        "in_progress",
      );
    });

    it("never completes a ready epic, even with every quest shelved", async ({
      expect,
    }) => {
      // Nothing in it was ever worked, and its plan is still open for a
      // quest that will be.
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "ready" });
      const shelved = await createTestQuest(alepha, project, {
        epicId: epic.id,
        shelvedAt: STAMP,
      });

      await app.workflow.completeIfResolved(shelved, undefined);

      expect((await app.repos.epics.getById(epic.id)).status).toBe("ready");
    });

    it("ignores another epic's quests", async ({ expect }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "in_progress",
      });
      const other = await createTestEpic(alepha, project, {
        status: "in_progress",
      });
      const last = await createTestQuest(alepha, project, {
        epicId: epic.id,
        completedAt: STAMP,
      });
      await createTestQuest(alepha, project, { epicId: other.id });

      await app.workflow.completeIfResolved(last, undefined);

      expect((await app.repos.epics.getById(epic.id)).status).toBe("completed");
      expect((await app.repos.epics.getById(other.id)).status).toBe(
        "in_progress",
      );
    });
  });
});
