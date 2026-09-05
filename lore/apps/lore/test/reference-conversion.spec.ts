import { Alepha, z } from "alepha";
import { files } from "alepha/api/files";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AdminReferenceController } from "../src/api/controllers/AdminReferenceController.ts";
import { BlobController } from "../src/api/controllers/BlobController.ts";
import { EpicController } from "../src/api/controllers/EpicController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestCommentController } from "../src/api/controllers/QuestCommentController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { epics } from "../src/api/entities/epics.ts";
import { folioRevisions } from "../src/api/entities/folioRevisions.ts";
import { folios } from "../src/api/entities/folios.ts";
import { questComments } from "../src/api/entities/questComments.ts";
import { quests } from "../src/api/entities/quests.ts";
import { releases } from "../src/api/entities/releases.ts";
import { LoreApi } from "../src/api/index.ts";
import { FolioLinkService } from "../src/api/services/FolioLinkService.ts";

const bootstrapAdmin = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * Direct reads of the rows the converter writes, and the framework `files`
 * row an attachment overlays (see `folio-blob-scope.spec.ts` for why the
 * upload endpoint is not used).
 */
class TestRows {
  public readonly files = $repository(files);
  public readonly folios = $repository(folios);
  public readonly quests = $repository(quests);
  public readonly epics = $repository(epics);
  public readonly comments = $repository(questComments);
  public readonly releases = $repository(releases);
  public readonly revisions = $repository(folioRevisions);
}

interface TestContext {
  alepha: Alepha;
  users: AdminUserController;
  projects: ProjectController;
  folios: FolioController;
  blobs: BlobController;
  quests: QuestController;
  comments: QuestCommentController;
  epics: EpicController;
  releases: ReleaseController;
  admin: AdminReferenceController;
  links: FolioLinkService;
  rows: TestRows;
  fake: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  alepha.with(TestRows);
  await alepha.start();
  return {
    alepha,
    users: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    folios: alepha.inject(FolioController),
    blobs: alepha.inject(BlobController),
    quests: alepha.inject(QuestController),
    comments: alepha.inject(QuestCommentController),
    epics: alepha.inject(EpicController),
    releases: alepha.inject(ReleaseController),
    admin: alepha.inject(AdminReferenceController),
    links: alepha.inject(FolioLinkService),
    rows: alepha.inject(TestRows),
    fake: alepha.inject(FakeProvider),
  };
};

const createUser = async (ctx: TestContext, roles: string[]) => {
  const fakeUser = ctx.fake.generate(userDataSchema);
  const r = await ctx.users.createUser.fetch(
    { body: { ...fakeUser, roles } },
    { user: bootstrapAdmin },
  );
  return { id: r.data.id, roles: r.data.roles };
};

const uploadedFile = async (
  ctx: TestContext,
  user: { id: string },
  name: string,
): Promise<string> => {
  const row = await ctx.rows.files.create({
    bucket: "archive-blobs",
    blobId: `blob-${name}-${crypto.randomUUID()}`,
    name,
    originalName: name,
    mimeType: "image/webp",
    size: 1234,
    creator: user.id,
  });
  return row.id;
};

/**
 * The one-shot converter of epic #32 (quest #1807): every stored reference,
 * in every kind of body, to the typed grammar, once, before the old grammar
 * is purged. What it must and must not touch is the rewrite table on the
 * service, and this spec is that table, run.
 */
describe("the reference converter", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const seed = async () => {
    const owner = await createUser(ctx, ["user"]);
    // A real row, because the folio revision the write appends is stamped
    // with the operator's id.
    const admin = await createUser(ctx, ["admin"]);
    const project = await ctx.projects.createProject.fetch(
      { body: { title: `Convert ${Date.now()}` } },
      { user: owner },
    );
    const projectId = project.data.id;

    const target = (
      await ctx.folios.create.fetch(
        { body: { projectId, title: "Design Notes", content: "the target" } },
        { user: owner },
      )
    ).data;
    const quest = (
      await ctx.quests.createQuest.fetch(
        {
          body: {
            projectId,
            title: "Wire the thing",
            description: "Per [[Design Notes]], do it.",
            area: "orm",
            priority: "high",
            objectives: [],
            attachments: [],
          },
        },
        { user: owner },
      )
    ).data;
    const epic = (
      await ctx.epics.createEpic.fetch(
        {
          params: { projectId },
          body: {
            title: "Ship it",
            description: "Holds [[quest:Wire the thing]] and [[Design Notes]].",
          },
        },
        { user: owner },
      )
    ).data;
    const comment = (
      await ctx.comments.createQuestComment.fetch(
        {
          params: { id: quest.id },
          body: { body: "Blocked by [[Design Notes]]." },
        },
        { user: owner },
      )
    ).data;
    const release = (
      await ctx.releases.createRelease.fetch(
        {
          params: { projectId },
          body: { tag: "0.1.0", description: "Ships [[Design Notes]]." },
        },
        { user: owner },
      )
    ).data;

    // The folio under conversion owns the attachment, so its blob refs
    // become `assets/` links; the folio after it does not, so its ref
    // becomes the served URL.
    const source = (
      await ctx.folios.create.fetch(
        { body: { projectId, title: "Notes", content: "" } },
        { user: owner },
      )
    ).data;
    const fileId = await uploadedFile(ctx, owner, "diagram.webp");
    const blob = (
      await ctx.blobs.registerBlob.fetch(
        {
          params: { projectId },
          body: { fileId, name: "diagram.webp", folioId: source.id },
        },
        { user: owner },
      )
    ).data;
    const body = [
      `See [[Design Notes]], [[#${target.shortId}]], [[Design Notes#intro]], [[quest:#${quest.shortId}]] and [[epic:Ship it]].`,
      "Missing: [[Nope]].",
      `Attached here: [[blob:#${blob.shortId}]] and ![pic](blob:#${blob.shortId}).`,
      "Code: `[[Design Notes]]`.",
    ].join("\n");
    await ctx.folios.update.fetch(
      { params: { id: source.id }, body: { content: body } },
      { user: owner },
    );
    const other = (
      await ctx.folios.create.fetch(
        {
          body: {
            projectId,
            title: "Other",
            content: `[[blob:#${blob.shortId}]]`,
          },
        },
        { user: owner },
      )
    ).data;

    return {
      owner,
      admin,
      projectId,
      target,
      quest,
      epic,
      comment,
      release,
      source,
      blob,
      fileId,
      other,
      body,
    };
  };

  it("dry run: reports every rewrite and writes nothing", async () => {
    const s = await seed();

    const report = (
      await ctx.admin.convertReferences.fetch(
        { body: { dryRun: true, projectId: s.projectId } },
        { user: s.admin },
      )
    ).data;

    expect(report.dryRun).toBe(true);
    expect(report.projects).toHaveLength(1);
    const [project] = report.projects;
    // Design Notes, the source, Other, the quest, the epic, the comment
    // and the release: seven bodies, six of them rewritten.
    expect(project.scanned).toBe(7);
    expect(project.rewritten).toBe(6);
    expect(project.anchorsDropped).toBe(1);
    expect(project.unresolved).toBe(1);
    const sourceRow = project.rows.find(
      (r) => r.kind === "folio" && r.number === s.source.shortId,
    );
    expect(sourceRow?.unresolved).toEqual(["[[Nope]]"]);
    expect(sourceRow?.tokens).toContainEqual({
      before: `[[quest:#${s.quest.shortId}]]`,
      after: `[[#Q${s.quest.shortId}]]`,
      count: 1,
    });
    // Two folios point at the attachment: two blob rows to delete, counted
    // and not yet deleted.
    expect(report.blobLinks).toBe(2);
    expect(await ctx.links.countLinksTo("blob")).toBe(2);

    const stored = await ctx.rows.folios.findOne({
      where: { id: { eq: s.source.id } },
    });
    expect(stored?.content).toBe(s.body);
  });

  it("write: every source carries the typed form, the attachment its own form, and the blob rows are gone", async () => {
    const s = await seed();
    const t = s.target.shortId;

    const report = (
      await ctx.admin.convertReferences.fetch(
        { body: { dryRun: false, projectId: s.projectId } },
        { user: s.admin },
      )
    ).data;
    expect(report.dryRun).toBe(false);
    expect(report.blobLinks).toBe(2);

    const source = await ctx.rows.folios.findOne({
      where: { id: { eq: s.source.id } },
    });
    expect(source?.content).toBe(
      [
        `See [[#F${t}]], [[#F${t}]], [[#F${t}]], [[#Q${s.quest.shortId}]] and [[#E${s.epic.number}]].`,
        "Missing: [[Nope]].",
        "Attached here: [diagram.webp](assets/diagram.webp) and ![pic](assets/diagram.webp).",
        "Code: `[[Design Notes]]`.",
      ].join("\n"),
    );

    const other = await ctx.rows.folios.findOne({
      where: { id: { eq: s.other.id } },
    });
    expect(other?.content).toBe(`[diagram.webp](/api/files/${s.fileId})`);

    const quest = await ctx.rows.quests.findOne({
      where: { id: { eq: s.quest.id } },
    });
    expect(quest?.description).toBe(`Per [[#F${t}]], do it.`);

    const epic = await ctx.rows.epics.findOne({
      where: { id: { eq: s.epic.id } },
    });
    expect(epic?.description).toBe(
      `Holds [[#Q${s.quest.shortId}]] and [[#F${t}]].`,
    );

    const comment = await ctx.rows.comments.findOne({
      where: { id: { eq: s.comment.id } },
    });
    expect(comment?.body).toBe(`Blocked by [[#F${t}]].`);

    const release = await ctx.rows.releases.findOne({
      where: { id: { eq: s.release.id } },
    });
    expect(release?.description).toBe(`Ships [[#F${t}]].`);

    // The graph was re-synced from the new text: the three kinds the source
    // reaches, and no blob row anywhere.
    const outbound = await ctx.links.findOutbound({
      kind: "folio",
      id: s.source.id,
    });
    expect(new Set(outbound.map((l) => l.targetType))).toEqual(
      new Set(["folio", "quest", "epic"]),
    );
    expect(await ctx.links.countLinksTo("blob")).toBe(0);

    // The rewritten folio has a revision to revert to.
    const revisions = await ctx.rows.revisions.findMany({
      where: { folioId: { eq: s.source.id } },
    });
    expect(revisions.some((r) => r.action === "edit")).toBe(true);

    // Running it again changes nothing: the typed form is a fixed point.
    const again = (
      await ctx.admin.convertReferences.fetch(
        { body: { dryRun: true, projectId: s.projectId } },
        { user: s.admin },
      )
    ).data;
    expect(again.projects[0].rewritten).toBe(0);
  });

  it("refuses a caller without the admin permission", async () => {
    const s = await seed();
    await expect(
      ctx.admin.convertReferences.fetch(
        { body: { dryRun: true } },
        { user: s.owner },
      ),
    ).rejects.toThrow();
  });
});
