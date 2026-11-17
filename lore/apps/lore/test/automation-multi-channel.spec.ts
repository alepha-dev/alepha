import {
  AutomationChannelRemoval,
  AutomationChannels,
  AutomationEvents,
  AutomationPersistence,
  AutomationService,
  AutomationWorker,
} from "@lore/core/api";
import { automationLine, createPresetRanks } from "@lore/core/testing";
import { ReleaseController } from "@lore/plan/api";
import { Alepha, AlephaError, z } from "alepha";
import { JobQueueProvider, jobExecutionEntity } from "alepha/api/jobs";
import {
  $notification,
  NotificationChannel,
  type NotificationRendered,
} from "alepha/api/notifications";
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

class RoomQueue extends JobQueueProvider {
  public override async dispatch() {}
}
class RoomRows {
  jobs = $repository(jobExecutionEntity);
}

/**
 * A test room (#Q3613): a channel addressed to nobody, like a Discord
 * channel.
 */
class TestRoomChannel extends NotificationChannel {
  public readonly channel = "testroom";
  public readonly addressable = false;
  public async render(): Promise<NotificationRendered> {
    return { recipient: "testroom:room" };
  }
  public async send() {
    return {};
  }
}
class TestRoomTemplates {
  protected readonly schema = z.record(z.string(), z.any());
  public readonly automations = $notification({
    name: "test:room:automations",
    category: "automations",
    schema: this.schema,
    testroom: { message: "room" },
  } as never);
  public readonly releases = $notification({
    name: "test:room:releases",
    category: "releases",
    schema: this.schema,
    testroom: { message: "room" },
  } as never);
  public readonly reminders = $notification({
    name: "test:room:reminders",
    category: "tasks",
    schema: this.schema,
    testroom: { message: "room" },
  } as never);
}

/**
 * One rule, several channels (#Q3613): a notify names an inbox and a room,
 * each gets one delivery, the room with no member; removing the room leaves
 * the rule notifying the inbox, unpaused; a rule left with no channel is
 * broken.
 */
describe("Multi-channel notify (#Q3613)", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;
  let persistence: AutomationPersistence;
  let rows: RoomRows;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let user: UserAccountToken;
  let rooms: { id: string; kind: string; name: string }[];

  const notifications = () =>
    rows.jobs.findMany({ where: { jobName: "system.notifications.send" } });
  const publish = async (tag: string) => {
    const controller = alepha.inject(ReleaseController);
    const release = (
      await controller.createRelease.fetch(
        {
          params: { projectId: project.id },
          body: { tag, title: `Release ${tag}` },
        },
        { user },
      )
    ).data;
    await controller.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );
  };
  const drain = async () => {
    await alepha.inject(AutomationEvents).sweep(50);
    const ready = await persistence.receipts.findMany({
      where: { kind: "occurrence", status: "ready" },
    });
    for (const receipt of ready) {
      let input: { receiptId: string; token?: string } | undefined = {
        receiptId: receipt.id,
      };
      for (let count = 0; input && count < 20; count++)
        input = await alepha.inject(AutomationWorker).step(input, 3);
      if (input) throw new AlephaError("Room worker exceeded its budget");
    }
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { DATABASE_URL: ":memory:", SERVER_PORT: 0, LOG_LEVEL: "silent" },
    })
      .with({ provide: CronProvider, use: ManualCronProvider })
      .with({ provide: JobQueueProvider, use: RoomQueue });
    bootLore(alepha);
    alepha.inject(TestRoomChannel);
    alepha.inject(TestRoomTemplates);
    entities = alepha.inject(TestEntityRepositories);
    persistence = alepha.inject(AutomationPersistence);
    rows = alepha.inject(RoomRows);
    const channels = alepha.inject(AutomationChannels);
    channels.register("testroom", {
      addressable: false,
      target: "text",
      configured: async () => true,
      templates: {
        automations: "test:room:automations",
        releases: "test:room:releases",
        reminders: "test:room:reminders",
      },
    });
    rooms = [{ id: "room-1", kind: "testroom", name: "Ops room" }];
    channels.registerInstances(async () => rooms);
    await alepha.start();
    project = await createTestProject(alepha, {
      capabilities: [{ key: "plan", options: { releases: true } }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    user = { id: project.createdBy, roles: ["user"] };
    await createPresetRanks(alepha, project.id);
  });
  afterEach(async () => {
    await alepha.stop();
  });

  const rule = () =>
    alepha.inject(AutomationService).create(project.id, user, {
      title: "Releases to the inbox and the room",
      enabled: true,
      rule: automationLine({
        trigger: { kind: "event", event: "release.published" },
        select: null,
        guard: null,
        actions: [
          {
            kind: "notify",
            recipient: user.id,
            channels: ["inbox", "room-1"],
            category: "releases",
            title: "Release {{release_tag}}",
            text: "{{title}}",
          },
        ],
      }),
    });

  it("delivers once per channel, the room with no member", async ({
    expect,
  }) => {
    const made = await rule();
    expect(
      made.rule!.nodes.find((node) => node.id === "action-1")!.config,
    ).toMatchObject({
      channels: ["inbox", "room-1"],
    });
    await publish("1.0.0");
    await drain();
    const sent = await notifications();
    expect(sent).toHaveLength(2);
    const types = sent.map((job) => (job.payload as { type: string }).type);
    expect(types.sort()).toEqual(["inbox", "testroom"]);
    const room = sent.find(
      (job) => (job.payload as { type: string }).type === "testroom",
    )!.payload as { contact?: string; variables: Record<string, unknown> };
    expect(room.contact).toBeUndefined();
    expect(room.variables.channelId).toBe("room-1");
    expect(room.variables.recipientUserId).toBeUndefined();
  });

  it("keeps notifying the inbox, unpaused, once the room is deleted", async ({
    expect,
  }) => {
    const made = await rule();
    rooms = [];
    expect(
      await alepha
        .inject(AutomationChannelRemoval)
        .remove(project.id, "room-1"),
    ).toBe(1);
    const stored = await persistence.rules.getById(made.id);
    expect(
      stored.rule.nodes.find((node) => node.id === "action-1")!.config,
    ).toMatchObject({ channels: ["inbox"] });
    expect(stored).toMatchObject({ enabled: true, health: "active" });
    await publish("1.0.0");
    await drain();
    const sent = await notifications();
    expect(sent.map((job) => (job.payload as { type: string }).type)).toEqual([
      "inbox",
    ]);
  });

  it("marks a rule broken once every channel it named is gone", async ({
    expect,
  }) => {
    const made = await alepha
      .inject(AutomationService)
      .create(project.id, user, {
        title: "Room only",
        enabled: true,
        rule: automationLine({
          trigger: { kind: "event", event: "release.published" },
          select: null,
          guard: null,
          actions: [
            {
              kind: "notify",
              channels: ["room-1"],
              category: "releases",
              title: "Release {{release_tag}}",
              text: "{{title}}",
            },
          ],
        }),
      });
    rooms = [];
    await alepha.inject(AutomationChannelRemoval).remove(project.id, "room-1");
    expect(await persistence.rules.getById(made.id)).toMatchObject({
      health: "broken",
    });
  });

  it("refuses an addressable channel without a member, and accepts a room alone", async ({
    expect,
  }) => {
    const service = alepha.inject(AutomationService);
    const notify = (channels: string[]) =>
      service.create(project.id, user, {
        title: "No member",
        rule: automationLine({
          trigger: { kind: "event", event: "release.published" },
          select: null,
          guard: null,
          actions: [
            {
              kind: "notify",
              channels,
              category: "releases",
              title: "t",
              text: "t",
            },
          ],
        }),
      });
    await expect(notify(["inbox"])).rejects.toThrow("needs a member");
    await expect(notify(["room-1"])).resolves.toBeDefined();
  });
});
