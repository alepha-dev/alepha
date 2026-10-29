import { ProjectController } from "@lore/core/api";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  DirectoryController,
  FolioController,
  LoreKnowledgeApi,
} from "../src/api/index.ts";

/**
 * Regression guard for #Q2779: `folio_update` called with `content` only
 * moved the folio to the project root. The MCP handler calls the action in
 * process, with `directoryId: undefined` present in the body, and the
 * controller read a present key as "move", landing the folio at the root.
 * Over HTTP the key never arrives (JSON drops it), so `.run()` is the call
 * that reproduces it.
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
  directoryController: DirectoryController;
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
  alepha.with(LoreKnowledgeApi);

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

describe("FolioController.update directory", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const arrange = async () => {
    const fakeUser = ctx.fakeProvider.generate(userDataSchema);
    const created = await ctx.adminUserController.createUser.fetch(
      { body: { ...fakeUser, roles: ["user"] } },
      { user: adminUser },
    );
    const owner = { id: created.data.id, roles: created.data.roles };
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: "Market research" } },
      { user: owner },
    );
    const directory = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: project.data.id }, body: { name: "Notes" } },
      { user: owner },
    );
    const folio = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: project.data.id,
          title: "Competitors",
          content: "first",
          directoryId: directory.data.id,
        },
      },
      { user: owner },
    );
    return { owner, directory: directory.data, folio: folio.data };
  };

  it("should keep the folio in its directory when directoryId is undefined", async ({
    expect,
  }) => {
    const { owner, directory, folio } = await arrange();

    const updated = await ctx.folioController.update.run(
      {
        params: { id: folio.id },
        body: { content: "second", directoryId: undefined },
      },
      { user: owner },
    );

    expect(updated.content).toBe("second");
    expect(updated.directoryId).toBe(directory.id);
  });

  it("should still move the folio to the root on an explicit null", async ({
    expect,
  }) => {
    const { owner, folio } = await arrange();

    const updated = await ctx.folioController.update.run(
      { params: { id: folio.id }, body: { directoryId: null } },
      { user: owner },
    );

    expect(updated.directoryId).toBeUndefined();
  });
});
