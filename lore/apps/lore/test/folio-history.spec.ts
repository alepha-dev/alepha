import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { folioHistoryAtom } from "../src/api/atoms/folioHistoryAtom.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import {
  decideRevisionAction,
  FolioHistoryService,
} from "../src/api/services/FolioHistoryService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  folioController: FolioController;
  historyService: FolioHistoryService;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    folioController: alepha.inject(FolioController),
    historyService: alepha.inject(FolioHistoryService),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

describe("decideRevisionAction", () => {
  const base = { title: "T", content: "C", summary: "S" };

  it("returns 'edit' when content changes", ({ expect }) => {
    expect(decideRevisionAction(base, { ...base, content: "D" })).toBe("edit");
  });

  it("returns 'edit' when summary changes (folded under edit)", ({
    expect,
  }) => {
    expect(decideRevisionAction(base, { ...base, summary: "T" })).toBe("edit");
  });

  it("returns 'rename' when only the title changes", ({ expect }) => {
    expect(decideRevisionAction(base, { ...base, title: "U" })).toBe("rename");
  });

  it("returns undefined when nothing relevant changed", ({ expect }) => {
    expect(decideRevisionAction(base, base)).toBeUndefined();
  });

  it("content beats rename when both changed at once", ({ expect }) => {
    expect(
      decideRevisionAction(base, {
        title: "U",
        content: "D",
        summary: "Z",
      }),
    ).toBe("edit");
  });
});

describe("FolioController history (#63)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("writes a 'create' revision on folio creation", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "History test" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Source",
          content: "v1",
        },
      },
      { user: owner },
    );

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(history.data).toHaveLength(1);
    expect(history.data[0]?.action).toBe("create");
    expect(history.data[0]?.contentSnapshot).toBe("v1");
  });

  it("writes a revision on edit with the action computed from the diff", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Edit" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Original",
          content: "first",
        },
      },
      { user: owner },
    );

    // Each mutation is pushed past the coalescing window so it becomes
    // its own revision — this test is about which action a diff produces, not about
    // folding. Inside the window they would fold into one row.
    // Title-only update → rename
    await ctx.alepha.inject(DateTimeProvider).travel(2, "hours");
    await ctx.folioController.update.fetch(
      { params: { id: folio.data.id }, body: { title: "Renamed" } },
      { user: owner },
    );
    // Content update → edit
    await ctx.alepha.inject(DateTimeProvider).travel(2, "hours");
    await ctx.folioController.update.fetch(
      { params: { id: folio.data.id }, body: { content: "second" } },
      { user: owner },
    );
    // Pin-only update → NO revision
    await ctx.folioController.update.fetch(
      { params: { id: folio.data.id }, body: { pinned: true } },
      { user: owner },
    );

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    // Newest first: edit, rename, create. Pin-only is absent.
    expect(history.data.map((r) => r.action)).toEqual([
      "edit",
      "rename",
      "create",
    ]);
  });

  it("enforces the retention cap (atom-tunable) by dropping oldest non-pinned", async ({
    expect,
  }) => {
    ctx.alepha.store.set(folioHistoryAtom, { maxRevisions: 3 });

    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Cap" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Cap test",
          content: "rev1",
        },
      },
      { user: owner },
    );

    // 4 edits → with the 'create' that's 5 revisions; cap = 3 means
    // 2 get trimmed (oldest non-pinned).
    // Each mutation is pushed past the coalescing window so it becomes
    // its own revision — this test is about the retention cap, not about
    // folding. Inside the window they would fold into one row.
    for (const value of ["rev2", "rev3", "rev4", "rev5"]) {
      await ctx.alepha.inject(DateTimeProvider).travel(2, "hours");
      await ctx.folioController.update.fetch(
        { params: { id: folio.data.id }, body: { content: value } },
        { user: owner },
      );
    }

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(history.data).toHaveLength(3);
    expect(history.data.map((r) => r.contentSnapshot)).toEqual([
      "rev5",
      "rev4",
      "rev3",
    ]);
  });

  it("never drops a pinned revision, even when older ones would normally be trimmed", async ({
    expect,
  }) => {
    ctx.alepha.store.set(folioHistoryAtom, { maxRevisions: 2 });

    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Pin survives" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Pin",
          content: "v1",
        },
      },
      { user: owner },
    );

    // Pin the create revision.
    const initial = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    const createRevId = initial.data[0]?.id;
    if (!createRevId) throw new Error("missing create revision");
    await ctx.folioController.pinHistory.fetch(
      {
        params: { id: folio.data.id, revisionId: createRevId },
        body: { pinned: true },
      },
      { user: owner },
    );

    // Pump 4 edits — non-pinned cap is 2; pinned survives.
    // Each mutation is pushed past the coalescing window so it becomes
    // its own revision — this test is about pinned revisions surviving the sweep, not about
    // folding. Inside the window they would fold into one row.
    for (const value of ["v2", "v3", "v4", "v5"]) {
      await ctx.alepha.inject(DateTimeProvider).travel(2, "hours");
      await ctx.folioController.update.fetch(
        { params: { id: folio.data.id }, body: { content: value } },
        { user: owner },
      );
    }

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    // 2 newest non-pinned + 1 pinned = 3.
    expect(history.data).toHaveLength(3);
    expect(history.data.find((r) => r.id === createRevId)?.pinned).toBe(true);
    expect(
      history.data.find((r) => r.id === createRevId)?.contentSnapshot,
    ).toBe("v1");
  });

  it("revert creates a NEW revision with the prior content (doesn't truly rewind)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Revert" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Revert test",
          content: "v1",
        },
      },
      { user: owner },
    );

    // Past the coalescing window, so `create` keeps its own v1 snapshot.
    // Inside the window the edit folds into it and v1 stops existing —
    // which is the documented cost of coalescing, not a bug, but it leaves
    // this test nothing distinct to revert to.
    await ctx.alepha.inject(DateTimeProvider).travel(2, "hours");
    await ctx.folioController.update.fetch(
      { params: { id: folio.data.id }, body: { content: "v2" } },
      { user: owner },
    );

    // History so far: [edit v2, create v1] (newest first). Revert to v1.
    const before = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    const createRevId = before.data.find((r) => r.action === "create")?.id;
    if (!createRevId) throw new Error("missing create revision");

    const reverted = await ctx.folioController.revertHistory.fetch(
      { params: { id: folio.data.id, revisionId: createRevId } },
      { user: owner },
    );
    expect(reverted.data.content).toBe("v1");

    const after = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    // [revert (snapshot of new state, content v1), edit v2, create v1].
    expect(after.data.map((r) => r.action)).toEqual([
      "revert",
      "edit",
      "create",
    ]);
    // The "edit v2" stays so the user can undo the revert.
    expect(after.data.find((r) => r.action === "edit")?.contentSnapshot).toBe(
      "v2",
    );
  });

  /**
   * Coalescing — the behaviour that makes auto-save affordable. Without it
   * a save per typing pause would insert a revision per pause and the
   * retention cap would evict the whole session within minutes.
   */
  it("folds a second edit by the same author into the open revision", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Coalesce" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      { body: { projectId: created.data.id, title: "T", content: "v1" } },
      { user: owner },
    );

    for (const content of ["v2", "v3", "v4"]) {
      await ctx.folioController.update.fetch(
        { params: { id: folio.data.id }, body: { content } },
        { user: owner },
      );
    }

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    // One entry, not four: three saves folded into the `create`.
    expect(history.data).toHaveLength(1);
    // …and it holds where the session got to, not where it started.
    expect(history.data[0]?.contentSnapshot).toBe("v4");
  });

  it("keeps the action the folded revision was created with", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Label" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      { body: { projectId: created.data.id, title: "T", content: "v1" } },
      { user: owner },
    );
    await ctx.folioController.update.fetch(
      { params: { id: folio.data.id }, body: { content: "v2" } },
      { user: owner },
    );

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    // A brand-new folio typed into for five minutes is still a creation,
    // not an edit.
    expect(history.data[0]?.action).toBe("create");
  });

  it("starts a new revision once the window has passed", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Window" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      { body: { projectId: created.data.id, title: "T", content: "v1" } },
      { user: owner },
    );

    await ctx.alepha.inject(DateTimeProvider).travel(2, "hours");

    await ctx.folioController.update.fetch(
      { params: { id: folio.data.id }, body: { content: "v2" } },
      { user: owner },
    );

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(history.data).toHaveLength(2);
    expect(history.data.map((r) => r.contentSnapshot).sort()).toEqual([
      "v1",
      "v2",
    ]);
  });

  it("never folds into a pinned revision", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Pinned" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      { body: { projectId: created.data.id, title: "T", content: "v1" } },
      { user: owner },
    );
    const initial = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    await ctx.folioController.pinHistory.fetch(
      {
        params: { id: folio.data.id, revisionId: initial.data[0]?.id ?? "" },
        body: { pinned: true },
      },
      { user: owner },
    );

    await ctx.folioController.update.fetch(
      { params: { id: folio.data.id }, body: { content: "v2" } },
      { user: owner },
    );

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    // Pinning means "keep exactly this snapshot" — folding would have
    // silently overwritten the thing the user asked to keep.
    expect(history.data).toHaveLength(2);
    expect(history.data.find((r) => r.pinned)?.contentSnapshot).toBe("v1");
  });

  it("never folds one author's edit into another's revision", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Authors" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      { body: { projectId: created.data.id, title: "T", content: "v1" } },
      { user: owner },
    );

    // Driven through the service rather than the controller: a second
    // account would have to be invited into the project first, and
    // membership is not what this asserts. Attribution is.
    const stored = await ctx.folioController.get.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    const other = await createTestUser(ctx);
    await ctx.historyService.appendRevision(
      { ...stored.data, content: "v2" },
      other.id,
      "edit",
    );

    const history = await ctx.folioController.listHistory.fetch(
      { params: { id: folio.data.id } },
      { user: owner },
    );
    expect(history.data).toHaveLength(2);
  });
});
