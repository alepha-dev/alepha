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
 * Every assertion in every phase, against real rows.
 *
 * The service is the single place the workflow's refusals are written, so
 * this is the single place their WORDING is pinned: the controllers that
 * call it are tested for the fact of a refusal, and this spec for what the
 * refusal says. An agent reads these strings and acts on them, which makes
 * the wording part of the contract rather than a detail of it.
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

    it("allows a quest whose epic is active", async ({ expect }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "active" });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      await expect(
        app.workflow.assertQuestWorkable(quest, "complete"),
      ).resolves.toBeUndefined();
    });

    it("refuses a planned epic's quest and says to begin the epic", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      await expect(
        app.workflow.assertQuestWorkable(quest, "accept"),
      ).rejects.toThrow(
        `Cannot accept quest #${quest.shortId}: Epic #${epic.number} is planned. Begin it first.`,
      );
    });

    it("refuses a concluded epic's quest and names the successor-epic route", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "done" });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      await expect(
        app.workflow.assertQuestWorkable(quest, "reopen"),
      ).rejects.toThrow(
        `Cannot reopen quest #${quest.shortId}: Epic #${epic.number} is concluded. File this in a new epic.`,
      );
    });

    it("carries the caller's verb, so five actions share one message shape", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "done" });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      for (const verb of [
        "accept",
        "assign",
        "complete",
        "reopen",
        "unshelve",
      ] as const) {
        await expect(
          app.workflow.assertQuestWorkable(quest, verb),
        ).rejects.toThrow(`Cannot ${verb} quest #${quest.shortId}:`);
      }
    });

    it("lets a planned epic's quest be unshelved, since that edits an open plan", async ({
      expect,
    }) => {
      // Shelve is allowed while planning, so unshelve has to be too, or a
      // quest set aside during planning could not come back until Begin.
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const quest = await createTestQuest(alepha, project, {
        epicId: epic.id,
        shelvedAt: "2026-09-04T00:00:00.000Z",
      });

      await expect(
        app.workflow.assertQuestWorkable(quest, "unshelve"),
      ).resolves.toBeUndefined();
      // The other four still refuse in `planned`.
      await expect(
        app.workflow.assertQuestWorkable(quest, "accept"),
      ).rejects.toThrow(/is planned. Begin it first/);
    });

    it("allows a quest whose epic row is gone rather than refusing", async ({
      expect,
    }) => {
      // A soft-deleted epic keeps `quests.epicId` pointing at it (only a
      // physical delete fires the FK's SET NULL) and `findOne` respects
      // `deletedAt`, so the row reads as missing. A missing epic is a loose
      // quest, never a refusal.
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "done" });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });
      await app.repos.epics.deleteById(epic.id);

      await expect(
        app.workflow.assertQuestWorkable(quest, "accept"),
      ).resolves.toBeUndefined();
    });
  });

  describe("assertPlanEditable", () => {
    it("allows every edit while the epic is planned", async ({ expect }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "add" }),
      ).not.toThrow();
      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "remove", quest }),
      ).not.toThrow();
      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "delete", quest }),
      ).not.toThrow();
    });

    it("refuses adding to an active epic and names both escape routes", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "active" });

      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "add" }),
      ).toThrow(
        `Cannot add a quest: Epic #${epic.number} is active. Its plan is frozen. File this in a new epic, or add an objective to a quest already in it.`,
      );
    });

    it("refuses adding to a concluded epic", async ({ expect }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "done" });

      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "add" }),
      ).toThrow(
        `Cannot add a quest: Epic #${epic.number} is concluded. File this in a new epic.`,
      );
    });

    it("refuses removing from an active epic and names shelve", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "active" });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "remove", quest }),
      ).toThrow(
        `Cannot remove quest #${quest.shortId}: Epic #${epic.number} is active. Its plan is frozen. Shelve it instead.`,
      );
    });

    it("refuses deleting inside an active epic and names shelve", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "active" });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "delete", quest }),
      ).toThrow(
        `Cannot delete quest #${quest.shortId}: Epic #${epic.number} is active. Its plan is frozen. Shelve it instead.`,
      );
    });

    it("refuses removing from or deleting inside a concluded epic", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "done" });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "remove", quest }),
      ).toThrow(
        `Cannot remove quest #${quest.shortId}: Epic #${epic.number} is concluded.`,
      );
      expect(() =>
        app.workflow.assertPlanEditable(epic, { kind: "delete", quest }),
      ).toThrow(
        `Cannot delete quest #${quest.shortId}: Epic #${epic.number} is concluded.`,
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
      const epic = await createTestEpic(alepha, project, { status: "active" });
      const completed = await createTestQuest(alepha, project, {
        epicId: epic.id,
        completedAt: "2026-09-04T00:00:00.000Z",
      });
      const shelved = await createTestQuest(alepha, project, {
        epicId: epic.id,
        shelvedAt: "2026-09-04T00:00:00.000Z",
      });

      expect(() =>
        app.workflow.assertPlanEditable(epic, {
          kind: "remove",
          quest: completed,
        }),
      ).toThrow(/is active. Its plan is frozen/);
      expect(() =>
        app.workflow.assertPlanEditable(epic, {
          kind: "remove",
          quest: shelved,
        }),
      ).toThrow(/is active. Its plan is frozen/);
    });
  });

  describe("assertQuestDeletable", () => {
    it("allows a loose quest and a planned epic's quest", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const loose = await createTestQuest(alepha, project);
      const parked = await createTestQuest(alepha, project, {
        epicId: epic.id,
      });

      await expect(
        app.workflow.assertQuestDeletable(loose),
      ).resolves.toBeUndefined();
      await expect(
        app.workflow.assertQuestDeletable(parked),
      ).resolves.toBeUndefined();
    });

    it("refuses inside an active epic, through the same message", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "active" });
      const quest = await createTestQuest(alepha, project, { epicId: epic.id });

      await expect(app.workflow.assertQuestDeletable(quest)).rejects.toThrow(
        `Cannot delete quest #${quest.shortId}: Epic #${epic.number} is active. Its plan is frozen. Shelve it instead.`,
      );
    });
  });

  describe("assertCanBegin", () => {
    it("allows an epic with no predecessor", async ({ expect }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project);

      await expect(app.workflow.assertCanBegin(epic)).resolves.toBeUndefined();
    });

    it("allows an epic whose predecessor is done", async ({ expect }) => {
      const { alepha, app, project } = await setup();
      const first = await createTestEpic(alepha, project, { status: "done" });
      const second = await createTestEpic(alepha, project, {
        dependsOn: first.id,
      });

      await expect(
        app.workflow.assertCanBegin(second),
      ).resolves.toBeUndefined();
    });

    /**
     * ⚠️ The opposite of what `EpicDependencyService.spec.ts` asserted until
     * epic #31: `epics.dependsOn` was advisory by a decision recorded on the
     * column on 2026-09-01, and the advisory channel measured zero (epic #27
     * was worked to 9 of 9 while planned, by an agent told the status on
     * every call). The column comment holds both decisions.
     */
    it("refuses while the predecessor is planned or active, naming both epics", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const planned = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const active = await createTestEpic(alepha, project, {
        status: "active",
      });
      const afterPlanned = await createTestEpic(alepha, project, {
        dependsOn: planned.id,
      });
      const afterActive = await createTestEpic(alepha, project, {
        dependsOn: active.id,
      });

      await expect(app.workflow.assertCanBegin(afterPlanned)).rejects.toThrow(
        `Cannot begin Epic #${afterPlanned.number}: it depends on Epic #${planned.number}, which is not concluded.`,
      );
      await expect(app.workflow.assertCanBegin(afterActive)).rejects.toThrow(
        `Cannot begin Epic #${afterActive.number}: it depends on Epic #${active.number}, which is not concluded.`,
      );
    });

    it("allows an epic whose predecessor row is gone", async ({ expect }) => {
      const { alepha, app, project } = await setup();
      const first = await createTestEpic(alepha, project, {
        status: "planned",
      });
      const second = await createTestEpic(alepha, project, {
        dependsOn: first.id,
      });
      await app.repos.epics.deleteById(first.id);

      await expect(
        app.workflow.assertCanBegin(second),
      ).resolves.toBeUndefined();
    });
  });

  describe("assertCanConclude", () => {
    it("allows an empty epic", async ({ expect }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "active" });

      await expect(
        app.workflow.assertCanConclude(epic),
      ).resolves.toBeUndefined();
    });

    it("allows an epic whose quests are all completed or shelved", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "active" });
      await createTestQuest(alepha, project, {
        epicId: epic.id,
        acceptedAt: "2026-09-04T00:00:00.000Z",
        completedAt: "2026-09-04T00:00:00.000Z",
      });
      await createTestQuest(alepha, project, {
        epicId: epic.id,
        shelvedAt: "2026-09-04T00:00:00.000Z",
      });

      await expect(
        app.workflow.assertCanConclude(epic),
      ).resolves.toBeUndefined();
    });

    it("refuses with the count of open quests, singular and plural", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const one = await createTestEpic(alepha, project, { status: "active" });
      await createTestQuest(alepha, project, { epicId: one.id });
      const three = await createTestEpic(alepha, project, {
        status: "active",
      });
      await createTestQuest(alepha, project, { epicId: three.id });
      await createTestQuest(alepha, project, { epicId: three.id });
      await createTestQuest(alepha, project, { epicId: three.id });
      // Resolved ones do not count.
      await createTestQuest(alepha, project, {
        epicId: three.id,
        shelvedAt: "2026-09-04T00:00:00.000Z",
      });

      await expect(app.workflow.assertCanConclude(one)).rejects.toThrow(
        `Cannot conclude Epic #${one.number}: 1 quest is still open. Complete or shelve each one.`,
      );
      await expect(app.workflow.assertCanConclude(three)).rejects.toThrow(
        `Cannot conclude Epic #${three.number}: 3 quests are still open. Complete or shelve each one.`,
      );
    });

    it("counts an accepted quest as open, and names the unassign route", async ({
      expect,
    }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "active" });
      await createTestQuest(alepha, project, {
        epicId: epic.id,
        acceptedAt: "2026-09-04T00:00:00.000Z",
      });

      await expect(app.workflow.assertCanConclude(epic)).rejects.toThrow(
        `Cannot conclude Epic #${epic.number}: 1 quest is still open. Complete or shelve each one. An accepted quest is unassigned first, then shelved.`,
      );
    });

    it("ignores another epic's quests", async ({ expect }) => {
      const { alepha, app, project } = await setup();
      const epic = await createTestEpic(alepha, project, { status: "active" });
      const other = await createTestEpic(alepha, project, { status: "active" });
      await createTestQuest(alepha, project, { epicId: other.id });

      await expect(
        app.workflow.assertCanConclude(epic),
      ).resolves.toBeUndefined();
    });
  });
});
