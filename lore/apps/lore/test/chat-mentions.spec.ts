import {
  ChatMentionNotifier,
  ChatMessageController,
  ChatRoomController,
} from "@lore/chat/api";
import {
  LoreInboxRecipientProvider,
  ProjectRoster,
  projectEvents,
} from "@lore/core/api";
import {
  createTestMemberByProjectId,
  createTestProject,
} from "@lore/core/testing";
import {
  NotificationInboxRecipientProvider,
  notificationInboxEntity,
} from "alepha/api/notifications";
import { BackgroundTaskProvider } from "alepha/background";
import { $repository } from "alepha/orm";
import { describe, it } from "vitest";

import { bootAssistant } from "./fixtures/bootAssistant.ts";

/**
 * The inbox, read straight from its table.
 */
class InboxRows {
  public readonly inbox = $repository(notificationInboxEntity);
  public readonly events = $repository(projectEvents);
}

/**
 * A notifier with no grace period: the spec decides who has read what
 * before it runs.
 */
class PromptNotifier extends ChatMentionNotifier {
  protected override grace(): number {
    return 0;
  }
}

/**
 * A chat mention reaches the mentioned member who is away (#E161, #Q3931):
 * a direct inbox item, never a project event, to someone who can see the
 * room, once per message, not from a muted room.
 */
describe("chat mention notifications", () => {
  const boot = async () => {
    const ctx = await bootAssistant({
      enabled: "0",
      extra: (alepha) => {
        alepha.with({
          provide: NotificationInboxRecipientProvider,
          use: LoreInboxRecipientProvider,
        });
        alepha.with({ provide: ChatMentionNotifier, use: PromptNotifier });
        alepha.inject(InboxRows);
      },
    });
    const project = await createTestProject(ctx.alepha, {
      title: "Acme",
      capabilities: [{ key: "plan" }, { key: "chat" }],
    });
    const owner = await ctx.signIn(project.createdBy);
    // Somebody the inbox can reach: an address and a handle.
    const person = async (name: string) =>
      ctx.signIn(
        (
          await ctx.entities.users.create({
            roles: ["user"],
            email: `${name}-${crypto.randomUUID()}@example.com`,
            username: `${name}${Math.floor(Math.random() * 1e6)}`,
          })
        ).id,
      );
    const member = await person("member");
    const outsider = await person("outsider");
    for (const user of [member, outsider]) {
      await createTestMemberByProjectId(ctx.alepha, project.id, user.id);
    }
    // The handle the parser resolves, from the same roster.
    const handleOf = async (userId: string) =>
      (await ctx.alepha.inject(ProjectRoster).of(project.id)).find(
        (it) => it.userId === userId,
      )!.name;
    const rooms = ctx.alepha.inject(ChatRoomController);
    const messages = ctx.alepha.inject(ChatMessageController);
    const createRoom = async (name: string, isPrivate: boolean) =>
      (
        await rooms.createChatRoom.fetch(
          {
            params: { projectId: project.id },
            body: { name, private: isPrivate },
          },
          { user: owner.user as never },
        )
      ).data;
    const send = async (roomId: string, body: string) =>
      (
        await messages.sendChatMessage.fetch(
          { params: { projectId: project.id, roomId }, body: { body } },
          { user: owner.user as never },
        )
      ).data;
    const settled = () => ctx.alepha.inject(BackgroundTaskProvider).flush();
    const inbox = () => ctx.alepha.inject(InboxRows).inbox.findMany({});
    return {
      ...ctx,
      project,
      owner,
      member,
      outsider,
      handleOf,
      rooms,
      messages,
      createRoom,
      send,
      settled,
      inbox,
    };
  };

  it("puts one inbox item, linking to the room, in the mentioned member's inbox", async ({
    expect,
  }) => {
    const ctx = await boot();
    const room = await ctx.createRoom("general", false);
    const handle = await ctx.handleOf(ctx.member.id);

    await ctx.send(room.id, `@${handle} can you look?`);
    await ctx.settled();

    // The push is in the request, the inbox write in a job.
    await expect.poll(async () => (await ctx.inbox()).length).toBe(1);
    const rows = await ctx.inbox();
    expect(rows[0]).toMatchObject({
      href: `/${ctx.project.slug}/chat/general`,
    });
    expect(rows[0]!.title).toContain("#general");
    // A direct item, never a project event: nothing for a channel to post.
    expect(await ctx.alepha.inject(InboxRows).events.count()).toBe(0);
  });

  it("notifies nobody outside a private room, nor a muted or reading member", async ({
    expect,
  }) => {
    const ctx = await boot();
    const secret = await ctx.createRoom("secret", true);
    const outsiderHandle = await ctx.handleOf(ctx.outsider.id);

    // Not in the room: the name stays plain text, nobody is told.
    await ctx.send(secret.id, `@${outsiderHandle} psst`);
    await ctx.settled();

    // Muted.
    const general = await ctx.createRoom("general", false);
    await ctx.messages.setChatRoomNotifyLevel.fetch(
      {
        params: { projectId: ctx.project.id, roomId: general.id },
        body: { level: "muted" },
      },
      { user: ctx.member.user as never },
    );
    const handle = await ctx.handleOf(ctx.member.id);
    await ctx.send(general.id, `@${handle} muted?`);
    await ctx.settled();

    // A control that does reach the member, sent last: once it is in, the
    // two above would be too had they been sent.
    const other = await ctx.createRoom("other", false);
    await ctx.send(other.id, `@${handle} this one counts`);
    await ctx.settled();
    await expect.poll(async () => (await ctx.inbox()).length).toBe(1);
    expect((await ctx.inbox())[0]!.title).toContain("#other");
  });

  it("notifies once when an edit adds a mention, and not again", async ({
    expect,
  }) => {
    const ctx = await boot();
    const room = await ctx.createRoom("general", false);
    const handle = await ctx.handleOf(ctx.member.id);
    const sent = await ctx.send(room.id, "no one yet");
    const edit = (body: string) =>
      ctx.messages.editChatMessage.fetch(
        {
          params: {
            projectId: ctx.project.id,
            roomId: room.id,
            messageId: sent.id,
          },
          body: { body },
        },
        { user: ctx.owner.user as never },
      );

    await edit(`now @${handle}`);
    await ctx.settled();
    await edit(`now @${handle}, again`);
    await ctx.settled();
    const other = await ctx.createRoom("other", false);
    await ctx.send(other.id, `@${handle} control`);
    await ctx.settled();

    // Once the control, sent last, is in: the first edit and the control,
    // never the second edit.
    await expect
      .poll(async () =>
        (await ctx.inbox()).some((it) => it.title.includes("#other")),
      )
      .toBe(true);
    expect(await ctx.inbox()).toHaveLength(2);
  });
  it("marks the room's mentions read in the inbox when the member reads the room (#Q4191)", async ({
    expect,
  }) => {
    const ctx = await boot();
    const general = await ctx.createRoom("general", false);
    const other = await ctx.createRoom("other", false);
    const handle = await ctx.handleOf(ctx.member.id);
    await ctx.rooms.joinChatRoom.fetch(
      { params: { projectId: ctx.project.id, roomId: general.id } },
      { user: ctx.member.user as never },
    );
    const sent = await ctx.send(general.id, `@${handle} look here`);
    await ctx.send(other.id, `@${handle} and here`);
    await ctx.settled();
    await expect.poll(async () => (await ctx.inbox()).length).toBe(2);

    await ctx.messages.markChatRoomRead.fetch(
      {
        params: { projectId: ctx.project.id, roomId: general.id },
        body: { messageId: sent.id },
      },
      { user: ctx.member.user as never },
    );

    const rows = await ctx.inbox();
    const read = (room: string) =>
      rows.find((it) => it.href.endsWith(`/chat/${room}`))!.readAt;
    // The room read is read in the inbox too; the other room is not.
    expect(read("general")).toBeTruthy();
    expect(read("other")).toBeFalsy();
  });
});
