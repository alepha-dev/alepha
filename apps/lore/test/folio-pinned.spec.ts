import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { foldPinnedFolios } from "../src/api/services/PinnedFolioFolder.ts";

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

describe("FolioController pinned sort + roundtrip (#59)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("sorts pinned folios to the top, then by updatedAt desc", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Pin sort" } },
      { user: owner },
    );
    const projectId = created.data.id;

    // Create three folios with a small delay between each so updatedAt
    // is strictly increasing.
    const titles = ["Oldest", "Middle", "Newest"];
    for (const title of titles) {
      await ctx.folioController.create.fetch(
        { body: { projectId, title, content: title } },
        { user: owner },
      );
      // Force-tick updatedAt so the ordering is unambiguous on fast
      // machines where consecutive inserts share a ms.
      await new Promise((r) => setTimeout(r, 5));
    }

    // Pin the oldest. After pinning, an update bumps updatedAt — so
    // first re-fetch the folio to read its shortId, then update with
    // pinned=true.
    const list1 = await ctx.folioController.list.fetch(
      { query: { projectId } },
      { user: owner },
    );
    const oldest = list1.data.find((f) => f.title === "Oldest");
    if (!oldest) throw new Error("missing folio");
    await ctx.folioController.update.fetch(
      { params: { id: oldest.id }, body: { pinned: true } },
      { user: owner },
    );

    const list2 = await ctx.folioController.list.fetch(
      { query: { projectId } },
      { user: owner },
    );
    expect(list2.data.map((f) => f.title)).toEqual([
      "Oldest", // pinned wins
      "Newest", // then newest non-pinned
      "Middle",
    ]);
  });

  it("update pinned=false flips the sort back", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Pin off" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: created.data.id,
          title: "Initially pinned",
          pinned: true,
        },
      },
      { user: owner },
    );
    expect(folio.data.pinned).toBe(true);

    const unpinned = await ctx.folioController.update.fetch(
      { params: { id: folio.data.id }, body: { pinned: false } },
      { user: owner },
    );
    expect(unpinned.data.pinned).toBe(false);
  });
});

describe("foldPinnedFolios cap behaviour (#59)", () => {
  const makeFolio = (id: string, content: string) => ({
    id,
    shortId: Number.parseInt(id, 10) || 0,
    title: `Folio ${id}`,
    content,
  });

  it("returns all folios untouched when total content fits the cap", ({
    expect,
  }) => {
    const result = foldPinnedFolios(
      [makeFolio("1", "abc"), makeFolio("2", "defgh")],
      100,
    );
    expect(result.pinnedFolios).toHaveLength(2);
    expect(result.pinnedFoliosTruncated).toBe(false);
    expect(result.pinnedFolios[0]?.truncatedAt).toBeUndefined();
    expect(result.pinnedFolios[1]?.content).toBe("defgh");
  });

  it("drops oldest-updated folios (caller-ordered tail) when the sum exceeds the cap", ({
    expect,
  }) => {
    const result = foldPinnedFolios(
      [
        makeFolio("1", "a".repeat(80)),
        makeFolio("2", "b".repeat(80)),
        makeFolio("3", "c".repeat(80)),
      ],
      100,
    );
    expect(result.pinnedFolios).toHaveLength(2);
    expect(result.pinnedFoliosTruncated).toBe(true);
    expect(result.pinnedFolios[0]?.content).toBe("a".repeat(80));
    // Second folio truncated at the remaining budget (100 - 80 = 20).
    expect(result.pinnedFolios[1]?.truncatedAt).toBe(20);
    expect(result.pinnedFolios[1]?.content).toBe("b".repeat(20));
  });

  it("truncates a single folio larger than the cap and flags as truncated only when more follow", ({
    expect,
  }) => {
    const single = foldPinnedFolios([makeFolio("1", "x".repeat(500))], 100);
    expect(single.pinnedFolios).toHaveLength(1);
    expect(single.pinnedFolios[0]?.truncatedAt).toBe(100);
    // No other folios followed — truncated reflects only "more were
    // dropped", not "we cut this one".
    expect(single.pinnedFoliosTruncated).toBe(false);

    const withTail = foldPinnedFolios(
      [makeFolio("1", "x".repeat(500)), makeFolio("2", "y")],
      100,
    );
    expect(withTail.pinnedFolios).toHaveLength(1);
    expect(withTail.pinnedFoliosTruncated).toBe(true);
  });

  it("handles empty input", ({ expect }) => {
    const result = foldPinnedFolios([], 100);
    expect(result.pinnedFolios).toEqual([]);
    expect(result.pinnedFoliosTruncated).toBe(false);
  });
});
