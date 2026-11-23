import { ChatRoomController, chatMessages, chatRooms } from "@lore/chat/api";
import {
  ProjectChannelController,
  ProjectEventDelivery,
  SubscriptionController,
} from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { DeployRegistry } from "@lore/ship/api";
import { appInstances, deployments } from "@lore/ship/schemas";
import { Alepha } from "alepha";
import {
  JobProvider,
  JobQueueProvider,
  jobExecutionEntity,
} from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { CronProvider } from "alepha/scheduler";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";
import { ManualCronProvider } from "./fixtures/ManualCronProvider.ts";

class QuietQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class Rows extends TestEntityRepositories {
  jobs = $repository(jobExecutionEntity);
  rooms = $repository(chatRooms);
  messages = $repository(chatMessages);
  instances = $repository(appInstances);
  deployments = $repository(deployments);
}

/**
 * A chat room as a notification channel (#Q4052): an event a channel is
 * subscribed to lands in the room as a message from Lore. Only an open room
 * is offered; an archived one takes nothing and the channel says so.
 */
describe("Chat room channels", () => {
  let alepha: Alepha;
  let rows: Rows;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let owner: UserAccountToken;
  const channels = () => alepha.inject(ProjectChannelController);
  const room = (name: string, isPrivate = false) =>
    rows.rooms.create({
      projectId: project.id,
      name,
      private: isPrivate,
      createdBy: owner.id,
    });
  const addRoom = (roomId: string) =>
    channels().createProjectChannel.fetch(
      {
        params: { projectId: project.id },
        body: { kind: "chat", roomId },
      },
      { user: owner },
    );
  const subscribe = (channelId: string) =>
    alepha.inject(SubscriptionController).setSubscription.fetch(
      {
        params: { projectId: project.id },
        body: { event: "deploy.failed", channelId },
      },
      { user: owner },
    );
  const drain = async () => {
    const jobs = alepha.inject(JobProvider);
    for (const job of await rows.jobs.findMany({
      where: { jobName: ProjectEventDelivery.JOB, status: "pending" },
    }))
      await jobs.processExecution(job.jobName, job.id);
  };
  const fail = async (app: string) => {
    const instance = await rows.instances.create({
      projectId: project.id,
      app,
      env: "production",
      createdBy: owner.id,
    });
    const deployment = await rows.deployments.create({
      projectId: project.id,
      instanceId: instance.id,
      app,
      tag: "latest",
      sha256: "a".repeat(64),
      status: "running",
    });
    await alepha.inject(DeployRegistry).failed(deployment.id, "Broken");
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        SERVER_PORT: 0,
        LOG_LEVEL: "silent",
        APP_SECRET: "a-spec-secret-that-is-not-the-default-one",
      },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: QuietQueue });
    bootLore(alepha);
    rows = alepha.inject(Rows);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [
        { key: "ship", options: { deploy: true } },
        { key: "chat", options: {} },
      ],
    });
    await createPresetRanks(alepha, project.id);
    await rows.users.updateById(project.createdBy, { roles: ["user"] });
    owner = { id: project.createdBy, roles: ["user"] };
  });
  afterEach(async () => {
    await alepha.stop();
  });

  it("offers the open rooms only, and refuses a private one", async ({
    expect,
  }) => {
    const ops = await room("ops");
    const secret = await room("secret", true);

    const offered = await channels().listProjectChannelRooms.fetch(
      { params: { projectId: project.id } },
      { user: owner },
    );
    expect(offered.data.items.map((it) => it.name)).toContain("ops");
    expect(offered.data.items.map((it) => it.name)).not.toContain("secret");

    await expect(addRoom(secret.id)).rejects.toThrow("not an open room");
    const created = (await addRoom(ops.id)).data;
    expect(created).toMatchObject({
      kind: "chat",
      roomId: ops.id,
      roomName: "ops",
      status: "active",
    });
  });

  it("posts a subscribed event into the room, as Lore", async ({ expect }) => {
    const ops = await room("ops");
    const channel = (await addRoom(ops.id)).data;
    await subscribe(channel.id);

    await fail("site");
    await drain();

    const posted = await rows.messages.findMany({
      where: { roomId: { eq: ops.id } },
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ agent: "lore" });
    expect(posted[0]?.authorId).toBeUndefined();
    expect(posted[0]?.body).toContain("site");
  });

  it("delivers nothing into an archived room, and the channel says so", async ({
    expect,
  }) => {
    const ops = await room("ops");
    const channel = (await addRoom(ops.id)).data;
    await subscribe(channel.id);
    await rows.rooms.updateById(ops.id, {
      archivedAt: "2026-11-21T12:00:00.000Z",
    });

    await fail("site");
    await drain();

    expect(
      await rows.messages.findMany({ where: { roomId: { eq: ops.id } } }),
    ).toHaveLength(0);
    const listed = await channels().listProjectChannels.fetch(
      { params: { projectId: project.id } },
      { user: owner },
    );
    expect(listed.data.items.find((it) => it.id === channel.id)).toMatchObject({
      status: "disabled",
      disabledReason: "room_archived",
    });
  });

  it("names a room channel after its room, with a suffix when that name is taken (#Q4187)", async ({
    expect,
  }) => {
    const ops = await room("general");

    const first = (await addRoom(ops.id)).data;
    const second = (await addRoom(ops.id)).data;

    expect(first.name).toBe("Room #general");
    expect(second.name).toMatch(/^Room #general-[0-9a-f]{4}$/);
  });

  it("renames a room's channels with the room, but not one renamed by hand (#Q4187)", async ({
    expect,
  }) => {
    const ops = await room("general");
    const generated = (await addRoom(ops.id)).data;
    const suffixed = (await addRoom(ops.id)).data;
    const custom = (await addRoom(ops.id)).data;
    await channels().updateProjectChannel.fetch(
      {
        params: { projectId: project.id, id: custom.id },
        body: { name: "Ops alerts" },
      },
      { user: owner },
    );

    await alepha.inject(ChatRoomController).renameChatRoom.fetch(
      {
        params: { projectId: project.id, roomId: ops.id },
        body: { name: "ops" },
      },
      { user: owner },
    );

    const listed = (
      await channels().listProjectChannels.fetch(
        { params: { projectId: project.id } },
        { user: owner },
      )
    ).data.items;
    const nameOf = (id: string) => listed.find((it) => it.id === id)?.name;
    expect(nameOf(generated.id)).toBe("Room #ops");
    expect(nameOf(suffixed.id)).toBe(
      `Room #ops${suffixed.name.slice("Room #general".length)}`,
    );
    expect(nameOf(custom.id)).toBe("Ops alerts");
  });
});
