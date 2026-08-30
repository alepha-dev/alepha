import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * `revisionsChanged` on the save response — the flag that stopped
 * `FolioHistoryTab` refetching the whole revision list after every
 * autosave.
 *
 * The number that matters: autosave fires 1.5s after typing stops, and
 * `FolioHistoryService.COALESCE_WINDOW_MS` is an HOUR. So a writing session
 * is ONE revision, and every save in it used to cost a `listHistory` — up
 * to ten full content snapshots — to re-render a list that had not changed.
 */
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

describe("FolioController save reports revisionsChanged", () => {
  let ctx: TestContext;
  let owner: { id: string; roles: string[] };
  let folioId: string;

  beforeEach(async () => {
    ctx = await setup();
    owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Revision churn" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: project.data.id,
          title: "Draft",
          content: "v1",
        },
      },
      { user: owner },
    );
    folioId = folio.data.id;
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const save = async (content: string): Promise<boolean> => {
    const res = await ctx.folioController.update.fetch(
      { params: { id: folioId }, body: { content } },
      { user: owner },
    );
    return res.data.revisionsChanged;
  };

  const historyLength = async (): Promise<number> => {
    const res = await ctx.folioController.listHistory.fetch(
      { params: { id: folioId } },
      { user: owner },
    );
    return res.data.length;
  };

  it("says true on create, which has nothing to fold into", async ({
    expect,
  }) => {
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Second" } },
      { user: owner },
    );
    const created = await ctx.folioController.create.fetch(
      { body: { projectId: project.data.id, title: "Fresh", content: "x" } },
      { user: owner },
    );
    expect(created.data.revisionsChanged).toBe(true);
  });

  it("says false for ten autosaves that fold into one revision", async ({
    expect,
  }) => {
    // The quest's own acceptance criterion, and the shape of a real typing
    // session: ten pauses inside the coalesce window. The first one folds
    // too — into the `create` revision the folio was seeded with — so the
    // whole burst is one row and not a single save reports a change.
    const answers: boolean[] = [];
    for (let i = 2; i <= 11; i++) {
      answers.push(await save(`v${i}`));
    }

    expect(answers).toEqual(Array(10).fill(false));
    expect(await historyLength()).toBe(1);
  });

  it("says true once the coalesce window has closed", async ({ expect }) => {
    expect(await save("v2")).toBe(false);

    // Past `COALESCE_WINDOW_MS` (one hour), so the next save opens its own
    // revision instead of folding.
    await ctx.alepha.inject(DateTimeProvider).travel(2, "hours");

    expect(await save("v3")).toBe(true);
    expect(await historyLength()).toBe(2);
  });

  it("says false for a write that records no revision at all", async ({
    expect,
  }) => {
    // Pin-only: `decideRevisionAction` returns undefined, so nothing is
    // appended and nothing folded either. Distinct from the coalesce case
    // and it must not be mistaken for one.
    const res = await ctx.folioController.update.fetch(
      { params: { id: folioId }, body: { pinned: true } },
      { user: owner },
    );

    expect(res.data.revisionsChanged).toBe(false);
    expect(await historyLength()).toBe(1);
  });

  it("says true when crossing the protection boundary", async ({ expect }) => {
    // The purge half of the flag. `purgeRevisions` empties the list, so a
    // client told only about insertions would keep rendering revisions the
    // server has deleted — which is why this is not `revisionCreated`.
    const res = await ctx.folioController.update.fetch(
      {
        params: { id: folioId },
        body: { protected: true, content: "ENVELOPE" },
      },
      { user: owner },
    );

    expect(res.data.revisionsChanged).toBe(true);
  });
});
