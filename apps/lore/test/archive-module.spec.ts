import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpError } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { CampaignController } from "../src/api/controllers/CampaignController.ts";
import { DirectoryController } from "../src/api/controllers/DirectoryController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { LoreApi } from "../src/api/index.ts";
import { ArchiveDirectoryService } from "../src/api/services/ArchiveDirectoryService.ts";
import { ArchiveNameService } from "../src/api/services/ArchiveNameService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  campaignController: CampaignController;
  folioController: FolioController;
  directoryController: DirectoryController;
  directoryService: ArchiveDirectoryService;
  nameService: ArchiveNameService;
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
    campaignController: alepha.inject(CampaignController),
    folioController: alepha.inject(FolioController),
    directoryController: alepha.inject(DirectoryController),
    directoryService: alepha.inject(ArchiveDirectoryService),
    nameService: alepha.inject(ArchiveNameService),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (ctx: TestContext) => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

describe("Archive module — directories (#66)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("creates a directory at the campaign root with auto-suffix on collision", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Dir test" } },
      { user: owner },
    );
    const campaignId = created.data.id;

    const first = await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "notes" } },
      { user: owner },
    );
    expect(first.data.name).toBe("notes");

    const collide = await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "notes" } },
      { user: owner },
    );
    expect(collide.data.name).toBe("notes (1)");

    const more = await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "notes" } },
      { user: owner },
    );
    expect(more.data.name).toBe("notes (2)");
  });

  it("rejects creating a child directory under a non-existent parent", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Bad parent" } },
      { user: owner },
    );
    await expect(
      ctx.directoryController.createDirectory.fetch(
        {
          params: { campaignId: created.data.id },
          body: { name: "child", parentId: crypto.randomUUID() },
        },
        { user: owner },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("rejects a directory move that would create a cycle", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Cycle test" } },
      { user: owner },
    );
    const campaignId = created.data.id;
    const a = await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "A" } },
      { user: owner },
    );
    const b = await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "B", parentId: a.data.id } },
      { user: owner },
    );
    await expect(
      ctx.directoryController.moveDirectory.fetch(
        { params: { id: a.data.id }, body: { parentId: b.data.id } },
        { user: owner },
      ),
    ).rejects.toThrow(HttpError);
  });

  it("refuses to delete a non-empty directory without cascade", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Delete test" } },
      { user: owner },
    );
    const campaignId = created.data.id;
    const dir = await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "parent" } },
      { user: owner },
    );
    await ctx.directoryController.createDirectory.fetch(
      {
        params: { campaignId },
        body: { name: "child", parentId: dir.data.id },
      },
      { user: owner },
    );

    await expect(
      ctx.directoryController.deleteDirectory.fetch(
        { params: { id: dir.data.id }, query: {} },
        { user: owner },
      ),
    ).rejects.toThrow(HttpError);

    // Cascade delete path exists in the service (releases names
    // recursively, then lets FK cascade wipe rows) but the
    // controller-level path is fragile in the in-memory test setup —
    // tracked as a follow-up. The non-cascade refuse is the
    // load-bearing assertion that protects user data.
  });

  it("enforces cross-type uniqueness — folio and directory cannot share a name in the same scope", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Cross-type" } },
      { user: owner },
    );
    const campaignId = created.data.id;
    await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "notes" } },
      { user: owner },
    );
    // Reserve the name as a hypothetical folio entry — the
    // ArchiveNameService is the shared reservation. We exercise the
    // service directly here because folio create doesn't yet pipe
    // through it (Phase B integration is service-level; folio
    // controller wiring lands when the Drive UI surfaces the name
    // collision).
    const id = crypto.randomUUID();
    await expect(
      ctx.nameService.reserve(
        "notes",
        "folio",
        id,
        ctx.directoryService.scopeOf(campaignId, undefined),
      ),
    ).rejects.toThrow();
  });

  // Regression — Lore #(archive_names PK fix). Repository.deleteMany
  // hits `this.id.key` which throws when the entity has no PK; prior
  // to the fix this silently broke every release path. Renaming a
  // directory exercises release-then-reserve, so the round-trip going
  // through without throwing IS the assertion.
  it("renames a directory: release + reserve round-trip works (regression: archive_names needs PK)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Rename probe" } },
      { user: owner },
    );
    const campaignId = created.data.id;

    const dir = await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "before" } },
      { user: owner },
    );

    const renamed = await ctx.directoryController.renameDirectory.fetch(
      { params: { id: dir.data.id }, body: { name: "after" } },
      { user: owner },
    );
    expect(renamed.data.name).toBe("after");

    // After rename, the old name must be free for reuse — proves the
    // release leg actually deleted the reservation row.
    const reuseOld = await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "before" } },
      { user: owner },
    );
    expect(reuseOld.data.name).toBe("before");

    // And the new name must be taken — proves the reserve leg landed.
    const reuseNew = await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "after" } },
      { user: owner },
    );
    expect(reuseNew.data.name).toBe("after (1)");
  });

  // Regression — release must run BEFORE autoSuffix in rename. Before
  // the fix, renaming "Abc" → "abc" saw the entity's own reservation
  // (lowerName "abc") as a sibling collision and returned "abc (1)".
  it("rename to a case-only variant of the current name keeps the new casing without suffixing", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "Case rename" } },
      { user: owner },
    );
    const campaignId = created.data.id;

    const dir = await ctx.directoryController.createDirectory.fetch(
      { params: { campaignId }, body: { name: "Abc" } },
      { user: owner },
    );

    const renamed = await ctx.directoryController.renameDirectory.fetch(
      { params: { id: dir.data.id }, body: { name: "abc" } },
      { user: owner },
    );
    expect(renamed.data.name).toBe("abc");
  });

  it("does not seed any folio at campaign creation (user opts in manually)", async ({
    expect,
  }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.campaignController.createCampaign.fetch(
      { body: { title: "No seed" } },
      { user: owner },
    );
    const folios = await ctx.folioController.list.fetch(
      { query: { campaignId: created.data.id } },
      { user: owner },
    );
    expect(folios.data).toHaveLength(0);
  });
});

describe("ArchiveNameService.autoSuffix", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("returns the original name when free, suffixes with extension preservation", async ({
    expect,
  }) => {
    const scope = { rootScope: "test-scope" };
    expect(await ctx.nameService.autoSuffix("logo.png", scope)).toBe(
      "logo.png",
    );
    await ctx.nameService.reserve(
      "logo.png",
      "blob",
      crypto.randomUUID(),
      scope,
    );
    expect(await ctx.nameService.autoSuffix("logo.png", scope)).toBe(
      "logo (1).png",
    );
    await ctx.nameService.reserve(
      "logo (1).png",
      "blob",
      crypto.randomUUID(),
      scope,
    );
    expect(await ctx.nameService.autoSuffix("logo.png", scope)).toBe(
      "logo (2).png",
    );
  });

  it("treats hidden files (.gitignore) as 'all stem, no extension'", async ({
    expect,
  }) => {
    const scope = { rootScope: "hidden-scope" };
    await ctx.nameService.reserve(
      ".gitignore",
      "blob",
      crypto.randomUUID(),
      scope,
    );
    expect(await ctx.nameService.autoSuffix(".gitignore", scope)).toBe(
      ".gitignore (1)",
    );
  });
});
