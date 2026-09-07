import { Alepha, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  notificationInboxEntity,
  NotificationInboxRecipientProvider,
  NotificationJobs,
} from "alepha/api/notifications";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { members } from "../src/api/entities/members.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreInboxRecipientProvider } from "../src/api/providers/LoreInboxRecipientProvider.ts";

class Probe {
  members = $repository(members);
  inbox = $repository(notificationInboxEntity);
  executions = $repository(jobExecutionEntity);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

const setup = async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
      PUBLIC_URL: "https://lore.test",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with({
    provide: NotificationInboxRecipientProvider,
    use: LoreInboxRecipientProvider,
  });
  alepha.with(LoreApi);

  const probe = alepha.inject(Probe);
  await alepha.start();

  return {
    alepha,
    probe,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    releases: alepha.inject(ReleaseController),
    fake: alepha.inject(FakeProvider),
    sendJobName: alepha.inject(NotificationJobs).sendNotification.name,
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const createUser = async (ctx: Ctx, username: string) => {
  const fake = ctx.fake.generate(userDataSchema);
  const response = await ctx.admin.createUser.fetch(
    { body: { ...fake, username, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

/**
 * ⚠️ Three members, not two. A two-person project cannot tell "everyone but
 * the publisher" from "the one person who is not me".
 */
const seed = async (ctx: Ctx) => {
  const publisher = await createUser(ctx, "publisher");
  const first = await createUser(ctx, "first");
  const second = await createUser(ctx, "second");

  const project = await ctx.projects.createProject.fetch(
    { body: { title: "Release probe" } },
    { user: publisher },
  );
  const projectId = project.data.id;

  await ctx.probe.members.create({ userId: first.id, projectId });
  await ctx.probe.members.create({ userId: second.id, projectId });

  const release = await ctx.releases.createRelease.fetch(
    { params: { projectId }, body: { title: "Lore Inbox", tag: "0.30.0" } },
    { user: publisher },
  );

  return { publisher, first, second, projectId, releaseId: release.data.id };
};

describe("publishing a release", () => {
  it("files one message for every member but the publisher", async ({
    expect,
  }) => {
    const ctx = await setup();
    const { publisher, first, second, projectId, releaseId } = await seed(ctx);

    await ctx.releases.publishRelease.fetch(
      { params: { id: releaseId }, body: {} },
      { user: publisher },
    );

    const rows = await ctx.probe.inbox.findMany({});
    expect(rows).toHaveLength(2);
    const byId = (a: string, b: string) => a.localeCompare(b);
    expect(rows.map((it) => String(it.userId)).sort(byId)).toEqual(
      [first.id, second.id].sort(byId),
    );
    expect(rows[0]).toMatchObject({
      template: "lore:inbox:release-published",
      category: "releases",
      scope: `project:${projectId}`,
      scopeLabel: "Release probe",
      title: "Release probe released 0.30.0",
      body: "Lore Inbox",
      href: "/release-probe/releases/0.30.0",
    });
    expect(rows.some((it) => it.userId === publisher.id)).toBe(false);

    await ctx.alepha.stop();
  });

  /**
   * One job row per contact per channel, which is what `pushMany` does and a
   * hand-rolled loop gets wrong.
   */
  it("queues both channels for each recipient", async ({ expect }) => {
    const ctx = await setup();
    const { publisher, releaseId } = await seed(ctx);

    await ctx.releases.publishRelease.fetch(
      { params: { id: releaseId }, body: {} },
      { user: publisher },
    );

    const rows = await ctx.probe.executions.findMany({
      where: { jobName: { eq: ctx.sendJobName } },
    });
    const byChannel = rows
      .map((it) => String((it.payload as any).type))
      .sort((a, b) => a.localeCompare(b));
    // Two members, two channels.
    expect(byChannel).toEqual(["email", "email", "inbox", "inbox"]);
    // Every payload carries an explicit language: `pushMany` has no fallback.
    expect(rows.every((it) => (it.payload as any).lang === "en")).toBe(true);

    await ctx.alepha.stop();
  });

  /**
   * "Published by mistake" is real, and a correction that mails everyone a
   * second time is worse than the mistake.
   */
  it("notifies nobody on reopen", async ({ expect }) => {
    const ctx = await setup();
    const { publisher, releaseId } = await seed(ctx);

    await ctx.releases.publishRelease.fetch(
      { params: { id: releaseId }, body: {} },
      { user: publisher },
    );
    const afterPublish = (await ctx.probe.inbox.findMany({})).length;

    await ctx.releases.reopenRelease.fetch(
      { params: { id: releaseId } },
      { user: publisher },
    );

    expect(await ctx.probe.inbox.findMany({})).toHaveLength(afterPublish);

    await ctx.alepha.stop();
  });

  it("says nothing when the publisher is the only member", async ({
    expect,
  }) => {
    const ctx = await setup();
    const publisher = await createUser(ctx, "solo");
    const project = await ctx.projects.createProject.fetch(
      { body: { title: "Solo probe" } },
      { user: publisher },
    );
    const release = await ctx.releases.createRelease.fetch(
      {
        params: { projectId: project.data.id },
        body: { title: "v1", tag: "1.0.0" },
      },
      { user: publisher },
    );

    await ctx.releases.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user: publisher },
    );

    expect(await ctx.probe.inbox.findMany({})).toHaveLength(0);

    await ctx.alepha.stop();
  });
});
