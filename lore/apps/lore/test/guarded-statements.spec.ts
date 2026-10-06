import { ProjectController, ResourceLinkService } from "@lore/core/api";
import { folioLinks } from "@lore/core/schemas";
import {
  DirectoryController,
  FolioController,
  FolioAttachmentService,
} from "@lore/knowledge/api";
import { folios } from "@lore/knowledge/schemas";
import { ReleaseController } from "@lore/work/api";
import { quests, releases } from "@lore/work/schemas";
import { $hook, Alepha, AlephaError, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, describe, it } from "vitest";

import { BlightController } from "../src/api/controllers/BlightController.ts";
import { blights } from "../src/api/entities/blights.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Lands a second request after the first one's read of `table`, once:
 * the D1 interleaving, made deterministic.
 */
class Interleave {
  public table?: string;
  /**
   * Reads of `table` to let through before firing.
   */
  public skip = 0;
  public next?: () => Promise<unknown>;

  onRead = $hook({
    on: "repository:read:after",
    handler: async ({ tableName }) => {
      if (tableName !== this.table || !this.next) return;
      if (this.skip > 0) {
        this.skip -= 1;
        return;
      }
      const run = this.next;
      this.next = undefined;
      await run();
    },
  });
}

/**
 * Records which files a subtree delete asked storage to drop.
 */
class RecordingAttachments extends FolioAttachmentService {
  public deletedFiles: string[][] = [];

  public override async deleteFiles(fileIds: readonly string[]) {
    this.deletedFiles.push([...fileIds]);
    await super.deleteFiles(fileIds);
  }
}

/**
 * The link cleanup of a subtree delete fails, midway through it.
 */
class FailingLinks extends ResourceLinkService {
  public fail = false;

  public override async deleteLinksFromMany(
    ...args: Parameters<ResourceLinkService["deleteLinksFromMany"]>
  ) {
    if (this.fail) throw new AlephaError("link cleanup failed");
    await super.deleteLinksFromMany(...args);
  }
}

class Rows {
  blights = $repository(blights);
  quests = $repository(quests);
  releases = $repository(releases);
  folios = $repository(folios);
  links = $repository(folioLinks);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

const setup = async () => {
  // Transactions off, as on D1: each guard is the only protection.
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "silent",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      DATABASE_TRANSACTIONS: false,
    },
  });
  alepha.with({ provide: FolioAttachmentService, use: RecordingAttachments });
  alepha.with({ provide: ResourceLinkService, use: FailingLinks });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  const interleave = alepha.inject(Interleave);
  const rows = alepha.inject(Rows);
  await alepha.start();

  const fake = alepha.inject(FakeProvider).generate(userDataSchema);
  const created = await alepha
    .inject(AdminUserController)
    .createUser.fetch(
      { body: { ...fake, roles: ["user"] } },
      { user: adminUser },
    );
  const user = { id: created.data.id, roles: created.data.roles };
  const project = await alepha.inject(ProjectController).createProject.fetch(
    {
      body: {
        title: "Guarded",
        capabilities: [
          { key: "work", options: { releases: true } },
          { key: "knowledge" },
          { key: "apps" },
        ],
      },
    },
    { user },
  );

  return {
    alepha,
    user,
    projectId: project.data.id,
    interleave,
    rows,
    attachments: alepha.inject(FolioAttachmentService) as RecordingAttachments,
    links: alepha.inject(ResourceLinkService) as FailingLinks,
  };
};

describe("guarded statements without transactions (#Q2550)", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  afterEach(async () => {
    await ctx?.alepha.stop();
  });

  it("a double forward of one blight makes one quest", async ({ expect }) => {
    ctx = await setup();
    const now = ctx.alepha.inject(DateTimeProvider).nowISOString();
    const blight = await ctx.rows.blights.create({
      projectId: ctx.projectId,
      fingerprint: "abc",
      name: "TypeError",
      message: "boom",
      firstSeenAt: now,
      lastSeenAt: now,
    });
    const forward = () =>
      ctx.alepha
        .inject(BlightController)
        .forwardBlightToQuest.fetch(
          { params: { projectId: ctx.projectId, blightId: blight.id } },
          { user: ctx.user },
        );

    // The second click lands after the first one read the blight open.
    ctx.interleave.table = "blights";
    ctx.interleave.next = forward;

    await expect(forward()).rejects.toThrow("already forwarded");

    const forwarded = (await ctx.rows.quests.findMany({})).filter(
      (quest) => quest.source?.sigilBlightId === blight.id,
    );
    expect(forwarded).toHaveLength(1);
    const after = await ctx.rows.blights.getById(blight.id);
    expect(after.status).toBe(`quest:${forwarded[0]!.id}`);
  });

  it("a default set racing a publish leaves no default on a published release", async ({
    expect,
  }) => {
    ctx = await setup();
    const controller = ctx.alepha.inject(ReleaseController);
    const release = await controller.createRelease.fetch(
      { params: { projectId: ctx.projectId }, body: { tag: "1.0.0" } },
      { user: ctx.user },
    );

    // After the handler reads the target unpublished: its first read of
    // `releases` is the current default.
    ctx.interleave.table = "releases";
    ctx.interleave.skip = 1;
    ctx.interleave.next = () =>
      controller.publishRelease.fetch(
        { params: { id: release.data.id }, body: {} },
        { user: ctx.user },
      );

    await expect(
      controller.setDefaultRelease.fetch(
        {
          params: { projectId: ctx.projectId },
          body: { releaseId: release.data.id },
        },
        { user: ctx.user },
      ),
    ).rejects.toMatchObject({ status: 409 });

    const row = await ctx.rows.releases.getById(release.data.id);
    expect(row.releasedAt).toBeDefined();
    expect(row.defaultSince).toBeUndefined();
  });

  it("a directory delete failing midway deletes nothing from storage", async ({
    expect,
  }) => {
    ctx = await setup();
    const directory = await ctx.alepha
      .inject(DirectoryController)
      .createDirectory.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Docs" } },
        { user: ctx.user },
      );
    const folio = await ctx.alepha.inject(FolioController).create.fetch(
      {
        body: {
          projectId: ctx.projectId,
          title: "Inside",
          content: "",
          directoryId: directory.data.id,
        },
      },
      { user: ctx.user },
    );

    ctx.links.fail = true;
    await expect(
      ctx.alepha
        .inject(DirectoryController)
        .deleteDirectory.fetch(
          { params: { id: directory.data.id }, query: { cascade: true } },
          { user: ctx.user },
        ),
    ).rejects.toThrow("link cleanup failed");

    // The folio survives, and storage was never asked to drop anything:
    // bytes go last, after every row that pointed at them.
    expect(await ctx.rows.folios.findById(folio.data.id)).toBeDefined();
    expect(ctx.attachments.deletedFiles).toEqual([]);
  });

  it("a cascading directory delete leaves no orphan outbound link", async ({
    expect,
  }) => {
    ctx = await setup();
    const folios = ctx.alepha.inject(FolioController);
    const target = await folios.create.fetch(
      { body: { projectId: ctx.projectId, title: "Target", content: "" } },
      { user: ctx.user },
    );
    const directory = await ctx.alepha
      .inject(DirectoryController)
      .createDirectory.fetch(
        { params: { projectId: ctx.projectId }, body: { name: "Gone" } },
        { user: ctx.user },
      );
    const inside = await folios.create.fetch(
      {
        body: {
          projectId: ctx.projectId,
          title: "Linker",
          content: `See [[#F${target.data.shortId}]].`,
          directoryId: directory.data.id,
        },
      },
      { user: ctx.user },
    );
    expect(await ctx.rows.links.count({ fromId: { eq: inside.data.id } })).toBe(
      1,
    );

    await ctx.alepha
      .inject(DirectoryController)
      .deleteDirectory.fetch(
        { params: { id: directory.data.id }, query: { cascade: true } },
        { user: ctx.user },
      );

    expect(await ctx.rows.links.count({ fromId: { eq: inside.data.id } })).toBe(
      0,
    );
  });
});
