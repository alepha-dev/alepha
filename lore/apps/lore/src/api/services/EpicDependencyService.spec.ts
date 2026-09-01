import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  createTestEpic,
  createTestProject,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import { EpicController } from "../controllers/EpicController.ts";
import { LoreApi } from "../index.ts";
import { EpicDependencyService } from "./EpicDependencyService.ts";

/**
 * `epics.dependsOn`: what it refuses, and the order it puts epics in.
 *
 * ⚠️ Read the column's own comment in `epics.ts` before changing anything
 * here. The field is **advisory** - no status transition is refused because
 * of it, deliberately - while **cycles are refused**, which is a different
 * question with a different answer. A spec that starts asserting the first
 * one is a design change, not a test.
 */

interface TestContext {
  alepha: Alepha;
  controller: EpicController;
  dependencies: EpicDependencyService;
  repos: TestEntityRepositories;
}

/**
 * `DATABASE_URL` is pinned for the reason `EpicController.spec.ts` pins it:
 * the ROOT vitest config points it at Postgres, which this app's SQLite
 * provider rejects outright.
 */
const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreApi);

  const repos = alepha.inject(TestEntityRepositories);
  await alepha.start();

  return {
    alepha,
    controller: alepha.inject(EpicController),
    dependencies: alepha.inject(EpicDependencyService),
    repos,
  };
};

const ownerToken = (project: { createdBy: string }): UserAccountToken => ({
  id: project.createdBy,
  roles: ["user"],
});

describe("EpicDependencyService", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  describe("what it refuses on write", () => {
    it("accepts a predecessor in the same project", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const first = await createTestEpic(ctx.alepha, project);
      const second = await createTestEpic(ctx.alepha, project);

      const updated = await ctx.controller.updateEpic(
        { params: { id: second.id }, body: { dependsOn: first.id } },
        { user: ownerToken(project) },
      );

      expect(updated.dependsOn).toBe(first.id);
      // Resolved to the `#N` every human-facing surface names an epic by.
      expect(updated.dependsOnNumber).toBe(first.number);
    });

    it("refuses an epic in another project", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const elsewhere = await createTestProject(ctx.alepha);
      const mine = await createTestEpic(ctx.alepha, project);
      const theirs = await createTestEpic(ctx.alepha, elsewhere);

      await expect(
        ctx.controller.updateEpic(
          { params: { id: mine.id }, body: { dependsOn: theirs.id } },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow();
    });

    it("refuses a self-reference", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const epic = await createTestEpic(ctx.alepha, project);

      await expect(
        ctx.controller.updateEpic(
          { params: { id: epic.id }, body: { dependsOn: epic.id } },
          { user: ownerToken(project) },
        ),
      ).rejects.toThrow(/cannot depend on itself/i);
    });

    /**
     * ⚠️ The case the quest called for by name. `quests.dependsOn` refuses a
     * self-reference and nothing longer, so a quest chain can still be
     * looped; this column cannot be, because the roadmap draws from it.
     */
    it("refuses a two-epic cycle, A to B to A", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const a = await createTestEpic(ctx.alepha, project);
      const b = await createTestEpic(ctx.alepha, project);
      const user = ownerToken(project);

      await ctx.controller.updateEpic(
        { params: { id: b.id }, body: { dependsOn: a.id } },
        { user },
      );

      await expect(
        ctx.controller.updateEpic(
          { params: { id: a.id }, body: { dependsOn: b.id } },
          { user },
        ),
      ).rejects.toThrow(/through another epic/i);
    });

    it("refuses a longer cycle, A to B to C to A", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const a = await createTestEpic(ctx.alepha, project);
      const b = await createTestEpic(ctx.alepha, project);
      const c = await createTestEpic(ctx.alepha, project);
      const user = ownerToken(project);

      await ctx.controller.updateEpic(
        { params: { id: b.id }, body: { dependsOn: a.id } },
        { user },
      );
      await ctx.controller.updateEpic(
        { params: { id: c.id }, body: { dependsOn: b.id } },
        { user },
      );

      await expect(
        ctx.controller.updateEpic(
          { params: { id: a.id }, body: { dependsOn: c.id } },
          { user },
        ),
      ).rejects.toThrow(/through another epic/i);
    });

    it("clears the link on null", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const first = await createTestEpic(ctx.alepha, project);
      const second = await createTestEpic(ctx.alepha, project);
      const user = ownerToken(project);

      await ctx.controller.updateEpic(
        { params: { id: second.id }, body: { dependsOn: first.id } },
        { user },
      );
      const cleared = await ctx.controller.updateEpic(
        { params: { id: second.id }, body: { dependsOn: null } },
        { user },
      );

      expect(cleared.dependsOn).toBeUndefined();
      expect(cleared.dependsOnNumber).toBeUndefined();
    });

    it("leaves the column alone when the field is omitted", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const first = await createTestEpic(ctx.alepha, project);
      const second = await createTestEpic(ctx.alepha, project);
      const user = ownerToken(project);

      await ctx.controller.updateEpic(
        { params: { id: second.id }, body: { dependsOn: first.id } },
        { user },
      );
      const renamed = await ctx.controller.updateEpic(
        { params: { id: second.id }, body: { title: "Renamed epic" } },
        { user },
      );

      expect(renamed.dependsOn).toBe(first.id);
    });

    it("takes a predecessor at create time", async ({ expect }) => {
      const project = await createTestProject(ctx.alepha);
      const first = await createTestEpic(ctx.alepha, project);

      const created = await ctx.controller.createEpic(
        {
          params: { projectId: project.id },
          body: { title: "The follow-up", dependsOn: first.id },
        },
        { user: ownerToken(project) },
      );

      expect(created.dependsOn).toBe(first.id);
    });

    /**
     * ⚠️ **Advisory, not a gate.** Activating an epic whose predecessor is
     * still `planned` is allowed, on purpose: epics overlap by design and a
     * refusal there would make people stop setting the field. This test is
     * the record of that decision - if it ever goes red, read the column
     * comment in `epics.ts` before "fixing" it.
     */
    it("does not refuse activating an epic whose predecessor is planned", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const first = await createTestEpic(ctx.alepha, project);
      const second = await createTestEpic(ctx.alepha, project);
      const user = ownerToken(project);

      await ctx.controller.updateEpic(
        { params: { id: second.id }, body: { dependsOn: first.id } },
        { user },
      );

      const activated = await ctx.controller.setEpicStatus(
        { params: { id: second.id }, body: { status: "active" } },
        { user },
      );

      expect(activated.status).toBe("active");
    });

    /**
     * `ON DELETE SET NULL`, and it matters more than usual here: `epics` is
     * the CASCADE parent nothing may take down, and deleting a predecessor
     * must unblock its dependents rather than delete them.
     */
    it("orphans the dependent when the predecessor is deleted", async ({
      expect,
    }) => {
      const project = await createTestProject(ctx.alepha);
      const first = await createTestEpic(ctx.alepha, project);
      const second = await createTestEpic(ctx.alepha, project);
      const user = ownerToken(project);

      await ctx.controller.updateEpic(
        { params: { id: second.id }, body: { dependsOn: first.id } },
        { user },
      );
      await ctx.controller.deleteEpic({ params: { id: first.id } }, { user });

      const survivor = await ctx.controller.getEpicByNumber(
        { params: { projectId: project.id, number: second.number } },
        { user },
      );

      expect(survivor.dependsOn).toBeUndefined();
    });
  });

  describe("order", () => {
    it("puts a predecessor before what depends on it", ({ expect }) => {
      // Declared out of order on purpose: `number` alone would keep 9 above 7.
      const nine = { id: 9, number: 9, dependsOn: undefined };
      const seven = { id: 7, number: 7, dependsOn: 9 };

      expect(
        ctx.dependencies.order([seven, nine]).map((epic) => epic.number),
      ).toEqual([9, 7]);
    });

    it("falls back to number for anything the graph does not order", ({
      expect,
    }) => {
      const list = [
        { id: 3, number: 3, dependsOn: undefined },
        { id: 1, number: 1, dependsOn: undefined },
        { id: 2, number: 2, dependsOn: undefined },
      ];

      expect(ctx.dependencies.order(list).map((epic) => epic.number)).toEqual([
        1, 2, 3,
      ]);
    });

    it("ignores a predecessor that is not in the list", ({ expect }) => {
      // A predecessor in another release, which orders nothing on this card.
      const list = [{ id: 2, number: 2, dependsOn: 99 }];
      expect(ctx.dependencies.order(list).map((epic) => epic.id)).toEqual([2]);
    });

    /**
     * ⚠️ A cycle cannot be written through `resolve`, so this is about rows
     * that predate it or a future path that forgets to call it. A page must
     * not fail to draw because of one, and it must not hang either.
     */
    it("terminates on a cycle rather than hanging", ({ expect }) => {
      const list = [
        { id: 1, number: 1, dependsOn: 2 },
        { id: 2, number: 2, dependsOn: 1 },
      ];

      const ordered = ctx.dependencies.order(list);
      expect(ordered).toHaveLength(2);
      expect(new Set(ordered.map((epic) => epic.id))).toEqual(new Set([1, 2]));
    });
  });
});
