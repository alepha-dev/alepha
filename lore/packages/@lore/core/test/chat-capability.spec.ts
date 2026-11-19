import {
  LorePermissions,
  ProjectCapabilityController,
  ProjectCapabilityHooks,
  ProjectController,
  ProjectRankPresets,
} from "@lore/core/api";
import { CapabilityRegistry } from "@lore/core/schemas";
import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { LoreCoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  capabilityController: ProjectCapabilityController;
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
  alepha.with(LoreCoreApi);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    capabilityController: alepha.inject(ProjectCapabilityController),
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

/**
 * Chat as a fourth capability (#E161, #Q3924): chosen in the wizard, never
 * preselected, off for a project that existed before it, turned on in
 * Settings, and the "capability turned on" hook its `general` room hangs off.
 */
describe("the chat capability", () => {
  let ctx: TestContext;
  let calls: Array<{ projectId: number; userId?: string }>;

  beforeEach(async () => {
    ctx = await setup();
    calls = [];
    ctx.alepha.inject(ProjectCapabilityHooks).register({
      key: "chat",
      name: "spec",
      enabled: async (event) => {
        calls.push(event);
      },
    });
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("is a choice in the wizard, never preselected", ({ expect }) => {
    const registry = ctx.alepha.inject(CapabilityRegistry);

    expect(registry.keys()).toContain("chat");
    expect(registry.get("chat").preselectedCapability).toBe(false);
    expect(registry.defaultSet().map((it) => it.key)).not.toContain("chat");
    expect(registry.ownerOfPermissionGroup("chat")).toBe("chat");
  });

  it("is off for a project created without it, and turns on in Settings, running the hook once", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Existing", capabilities: [{ key: "plan" }] } },
      { user },
    );
    expect(created.data.capabilities.map((it) => it.key)).not.toContain("chat");
    expect(calls).toEqual([]);

    const turnOn = () =>
      ctx.capabilityController.setCapability.fetch(
        {
          params: { projectId: created.data.id, key: "chat" },
          body: { enabled: true },
        },
        { user },
      );
    const on = await turnOn();
    expect(on.data.capabilities.map((it) => it.key)).toContain("chat");
    expect(calls).toEqual([{ projectId: created.data.id, userId: user.id }]);

    // Saved again while on: the row exists, the hook does not run.
    await turnOn();
    expect(calls).toHaveLength(1);

    // Off, then on again: it runs again, which is why a hook is idempotent.
    await ctx.capabilityController.setCapability.fetch(
      {
        params: { projectId: created.data.id, key: "chat" },
        body: { enabled: false },
      },
      { user },
    );
    await turnOn();
    expect(calls).toHaveLength(2);
  });

  it("runs the hook when the wizard creates the project with chat", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      {
        body: {
          title: "Chatty",
          capabilities: [{ key: "plan" }, { key: "chat" }],
        },
      },
      { user },
    );

    expect(calls).toEqual([{ projectId: created.data.id, userId: user.id }]);
  });

  it("keeps the capability on when a hook fails", async ({ expect }) => {
    ctx.alepha.inject(ProjectCapabilityHooks).register({
      key: "chat",
      name: "failing",
      enabled: async () => {
        throw new Error("boom");
      },
    });
    const user = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Sturdy", capabilities: [{ key: "chat" }] } },
      { user },
    );

    expect(created.data.capabilities.map((it) => it.key)).toContain("chat");
  });

  it("gives a Member read and write, a Viewer read, an Admin manage", ({
    expect,
  }) => {
    const [admin, viewer] = ctx.alepha
      .inject(ProjectRankPresets)
      .presetsFor(["plan", "chat"]);

    expect(LorePermissions.MEMBER_DEFAULT).toEqual(
      expect.arrayContaining(["chat:read", "chat:write"]),
    );
    expect(LorePermissions.MEMBER_DEFAULT).not.toContain("chat:manage");
    expect(admin!.permissions).toEqual(
      expect.arrayContaining(["chat:read", "chat:write", "chat:manage"]),
    );
    expect(viewer!.permissions).toContain("chat:read");
    expect(viewer!.permissions).not.toContain("chat:write");
  });
});
