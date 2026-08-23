import { Alepha, z } from "alepha";
import { FileService } from "alepha/api/files";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, describe, expect, it } from "vitest";

import { InvitationController } from "../src/api/controllers/InvitationController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ProjectQuestPortabilityController } from "../src/api/controllers/ProjectQuestPortabilityController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * The membership and owner gates compare `user.ownership` with `false`, and
 * the token only carries that field when the action named a permission. A
 * bare `$secure()` action left it `undefined`, which the gates used to read
 * as "privileged identity": any logged-in user could export, overwrite by
 * import, or list the invitations of any project. These are the three actions
 * that were caught, plus the two quest paths that trusted a bare file id.
 */
const adminUser = {
  id: crypto.randomUUID(),
  roles: ["admin"],
  realm: "default",
};

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

// 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const setup = async () => {
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

  const admin = alepha.inject(AdminUserController);
  const fake = alepha.inject(FakeProvider);

  const newUser = async () => {
    const data = fake.generate(userDataSchema);
    const res = await admin.createUser.fetch(
      { body: { ...data, roles: ["user"] } },
      { user: adminUser },
    );
    return { id: res.data.id, roles: res.data.roles, email: data.email };
  };

  return {
    alepha,
    newUser,
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    port: alepha.inject(ProjectQuestPortabilityController),
    invites: alepha.inject(InvitationController),
    files: alepha.inject(FileService),
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;
type User = Awaited<ReturnType<Ctx["newUser"]>>;

const ownedProject = async (ctx: Ctx, user: User, title: string) => {
  const created = await ctx.projects.createProject.fetch(
    { body: { title } },
    { user },
  );
  return created.data;
};

const newQuest = async (
  ctx: Ctx,
  user: User,
  projectId: number,
  title: string,
  extra: Record<string, unknown> = {},
) => {
  const created = await ctx.quests.createQuest.fetch(
    {
      body: { projectId, title, area: "core", priority: "medium", ...extra },
    },
    { user },
  );
  return created.data;
};

const uploadAs = async (ctx: Ctx, user: User, name: string) => {
  const res = await ctx.quests.uploadAttachment.fetch(
    {
      body: {
        file: new File([new Uint8Array(PNG_BYTES)], name, {
          type: "image/png",
        }),
      },
    },
    { user },
  );
  return res.data.fileId;
};

describe("project security gates", () => {
  let ctx: Ctx;

  afterEach(async () => {
    await ctx?.alepha.stop();
  });

  it("refuses a stranger the quest export of a project", async () => {
    ctx = await setup();
    const owner = await ctx.newUser();
    const stranger = await ctx.newUser();
    const project = await ownedProject(ctx, owner, "Owned Alpha");
    await newQuest(ctx, owner, project.id, "Secret plan of Alpha");

    await expect(
      ctx.port.exportQuests.fetch(
        { params: { id: project.id } },
        { user: stranger },
      ),
    ).rejects.toThrow();

    const res = await ctx.port.exportQuests.fetch(
      { params: { id: project.id } },
      { user: owner },
    );
    expect(await res.data.text()).toContain("Secret plan of Alpha");
  });

  it("refuses a stranger the CSV import of a project", async () => {
    ctx = await setup();
    const owner = await ctx.newUser();
    const stranger = await ctx.newUser();
    const project = await ownedProject(ctx, owner, "Owned Beta");
    const quest = await newQuest(ctx, owner, project.id, "Original title");

    const csv = `"shortId","title","priority"\n"${quest.shortId}","HIJACKED","high"\n`;
    await expect(
      ctx.port.importQuests.fetch(
        {
          params: { id: project.id },
          body: { file: new File([csv], "q.csv", { type: "text/csv" }) },
        },
        { user: stranger },
      ),
    ).rejects.toThrow();

    const after = await ctx.quests.getQuestByShortId.fetch(
      { params: { projectId: project.id, shortId: quest.shortId } },
      { user: owner },
    );
    expect(after.data.title).toBe("Original title");
  });

  it("refuses a stranger the pending invitations of a project", async () => {
    ctx = await setup();
    const owner = await ctx.newUser();
    const stranger = await ctx.newUser();
    const project = await ownedProject(ctx, owner, "Owned Gamma");

    await ctx.invites.createInvitation.fetch(
      {
        body: {
          email: "victim@example.com",
          resourceType: "project",
          resourceId: String(project.id),
        },
      },
      { user: owner },
    );

    await expect(
      ctx.invites.listProjectInvitations.fetch(
        { params: { projectId: project.id } },
        { user: stranger },
      ),
    ).rejects.toThrow();

    const mine = await ctx.invites.listProjectInvitations.fetch(
      { params: { projectId: project.id } },
      { user: owner },
    );
    expect(mine.data.map((it) => it.email)).toContain("victim@example.com");
  });

  it("removeAttachment only touches a file the quest lists", async () => {
    ctx = await setup();
    const victim = await ctx.newUser();
    const attacker = await ctx.newUser();
    const victimFile = await uploadAs(ctx, victim, "victim.png");

    const project = await ownedProject(ctx, attacker, "Attacker Proj");
    const quest = await newQuest(ctx, attacker, project.id, "mine");

    // The handler used to delete ANY file in the instance by id.
    await expect(
      ctx.quests.removeAttachment.fetch(
        { params: { id: quest.id, fileId: victimFile } },
        { user: attacker },
      ),
    ).rejects.toThrow();

    const kept = await ctx.files.getFileById(victimFile);
    expect(kept.id).toBe(victimFile);
  });

  it("deleteQuest clears the dependents that pointed at it", async () => {
    ctx = await setup();
    const owner = await ctx.newUser();
    const project = await ownedProject(ctx, owner, "Owned Eps");
    const x = await newQuest(ctx, owner, project.id, "X first");
    const y = await newQuest(ctx, owner, project.id, "Y after", {
      dependsOn: x.id,
    });
    expect(y.dependsOn).toBe(x.id);

    await ctx.quests.deleteQuest.fetch(
      { params: { id: x.id } },
      { user: owner },
    );

    // `{ dependsOn: undefined }` was a no-op update, so the graph kept an
    // edge to a deleted quest.
    const graph = await ctx.quests.getDependencyGraph.fetch(
      { params: { projectId: project.id } },
      { user: owner },
    );
    const yRow = graph.data.find((q) => q.id === y.id);
    expect(yRow?.dependsOn ?? null).toBeNull();
  });

  it("only lists the caller's own uploads as quest attachments", async () => {
    ctx = await setup();
    const victim = await ctx.newUser();
    const attacker = await ctx.newUser();
    const victimFile = await uploadAs(ctx, victim, "secret.png");
    const ownFile = await uploadAs(ctx, attacker, "mine.png");
    const project = await ownedProject(ctx, attacker, "Attacker Zeta");

    // Listing a file id used to be enough to read it through the quest
    // attachment gate, whoever uploaded it and wherever it lives.
    const quest = await newQuest(ctx, attacker, project.id, "claims", {
      attachments: [victimFile, ownFile],
      description: `![](/api/files/${victimFile})`,
    });
    expect(quest.attachments).toEqual([ownFile]);

    await expect(
      ctx.quests.addAttachment.fetch(
        { params: { id: quest.id }, body: { fileId: victimFile } },
        { user: attacker },
      ),
    ).rejects.toMatchObject({ status: 404 });

    const updated = await ctx.quests.updateQuestById.fetch(
      {
        params: { id: quest.id },
        body: { description: `![](/api/files/${victimFile}) still mine` },
      },
      { user: attacker },
    );
    expect(updated.data.attachments).toEqual([ownFile]);
  });
});
