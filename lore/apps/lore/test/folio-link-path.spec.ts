import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import type { LinkTargetKind } from "@/api/schemas/linkTargetKindSchema.ts";

import { DirectoryController } from "../src/api/controllers/DirectoryController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  directoryController: DirectoryController;
  folioController: FolioController;
  fakeProvider: FakeProvider;
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
  await alepha.start();
  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    directoryController: alepha.inject(DirectoryController),
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

const folioOutboundShortIds = (
  outbound: Array<{
    kind: LinkTargetKind;
    shortId: number;
    title: string;
  }>,
) =>
  outbound
    .filter((l) => l.kind === "folio")
    .map((l) => l.shortId)
    .sort((a, b) => a - b);

describe("FolioLinkService — path-style refs", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const setupTree = async () => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Link path test" } },
      { user: owner },
    );
    const cid = project.data.id;
    const specs = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: cid }, body: { name: "specs" } },
      { user: owner },
    );
    const apps = await ctx.directoryController.createDirectory.fetch(
      {
        params: { projectId: cid },
        body: { name: "apps", parentId: specs.data.id },
      },
      { user: owner },
    );
    const strategy = await ctx.directoryController.createDirectory.fetch(
      {
        params: { projectId: cid },
        body: { name: "strategy", parentId: specs.data.id },
      },
      { user: owner },
    );
    const adminFolio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "admin",
          content: "stub",
          directoryId: apps.data.id,
        },
      },
      { user: owner },
    );
    const roadmapFolio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "roadmap",
          content: "stub",
          directoryId: strategy.data.id,
        },
      },
      { user: owner },
    );
    return {
      owner,
      cid,
      specs: specs.data,
      apps: apps.data,
      strategy: strategy.data,
      adminFolio: adminFolio.data,
      roadmapFolio: roadmapFolio.data,
    };
  };

  it("resolves a fully-anchored path link", async ({ expect }) => {
    const { owner, cid, adminFolio, roadmapFolio } = await setupTree();
    const source = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "Index",
          content: "See [[specs/apps/admin]] and [[specs/strategy/roadmap]].",
        },
      },
      { user: owner },
    );
    const links = await ctx.folioController.getLinks.fetch(
      { params: { id: source.data.id } },
      { user: owner },
    );
    expect(folioOutboundShortIds(links.data.outbound)).toEqual(
      [adminFolio.shortId, roadmapFolio.shortId].sort((a, b) => a - b),
    );
  });

  it("resolves a shorthand path link (suffix match) when unique", async ({
    expect,
  }) => {
    const { owner, cid, roadmapFolio } = await setupTree();
    const source = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "Idx2",
          content: "Pointer: [[strategy/roadmap]].",
        },
      },
      { user: owner },
    );
    const links = await ctx.folioController.getLinks.fetch(
      { params: { id: source.data.id } },
      { user: owner },
    );
    expect(folioOutboundShortIds(links.data.outbound)).toEqual([
      roadmapFolio.shortId,
    ]);
  });

  it("drops a shorthand link when ambiguous; anchored still wins", async ({
    expect,
  }) => {
    const { owner, cid, roadmapFolio } = await setupTree();
    const other = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: cid }, body: { name: "other" } },
      { user: owner },
    );
    const strategy2 = await ctx.directoryController.createDirectory.fetch(
      {
        params: { projectId: cid },
        body: { name: "strategy", parentId: other.data.id },
      },
      { user: owner },
    );
    await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "roadmap",
          content: "stub",
          directoryId: strategy2.data.id,
        },
      },
      { user: owner },
    );
    const ambiguous = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "IdxAmbig",
          content: "Ambiguous: [[strategy/roadmap]].",
        },
      },
      { user: owner },
    );
    const ambigLinks = await ctx.folioController.getLinks.fetch(
      { params: { id: ambiguous.data.id } },
      { user: owner },
    );
    expect(folioOutboundShortIds(ambigLinks.data.outbound)).toEqual([]);

    const anchored = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "IdxAnchored",
          content: "Anchored: [[specs/strategy/roadmap]].",
        },
      },
      { user: owner },
    );
    const anchoredLinks = await ctx.folioController.getLinks.fetch(
      { params: { id: anchored.data.id } },
      { user: owner },
    );
    expect(folioOutboundShortIds(anchoredLinks.data.outbound)).toEqual([
      roadmapFolio.shortId,
    ]);
  });

  it("falls back to title match when path doesn't resolve", async ({
    expect,
  }) => {
    const { owner, cid } = await setupTree();
    const literal = await ctx.folioController.create.fetch(
      {
        body: { projectId: cid, title: "a/b/c", content: "stub" },
      },
      { user: owner },
    );
    const source = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "IdxFallback",
          content: "Literal: [[a/b/c]].",
        },
      },
      { user: owner },
    );
    const links = await ctx.folioController.getLinks.fetch(
      { params: { id: source.data.id } },
      { user: owner },
    );
    expect(folioOutboundShortIds(links.data.outbound)).toEqual([
      literal.data.shortId,
    ]);
  });
});
