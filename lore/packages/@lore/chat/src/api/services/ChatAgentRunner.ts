import { McpProjectScope, ProjectRoster } from "@lore/core/api";
import { $inject, Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ConflictError, ForbiddenError, NotFoundError } from "alepha/server";

import { type ChatMessage, chatMessages } from "../entities/chatMessages.ts";
import { chatRoomMembers } from "../entities/chatRoomMembers.ts";
import type { ChatRoom } from "../entities/chatRooms.ts";
import { ChatAudience } from "./ChatAudience.ts";
import { ChatLive } from "./ChatLive.ts";
import { ChatMessageService } from "./ChatMessageService.ts";
import {
  type ChatAgentEvent,
  ChatResponderRegistry,
} from "./ChatResponderRegistry.ts";
import { ChatRoomService } from "./ChatRoomService.ts";

/**
 * Runs an agent a member mentioned in a room (#E161, #Q3930).
 *
 * - **As the mentioner.** The run is theirs: their permissions decide the
 *   tools, their budget pays, and only they decide a paused write.
 * - **Pinned to the room's project, in code.** The whole run is inside
 *   `McpProjectScope.pinned`, so a tool that resolves any other project is
 *   refused whatever the model asked. Other members' messages are model
 *   input, so the prompt's own rule is not enough.
 * - **The room's text is data.** Only the room the agent was mentioned in,
 *   its last {@link HISTORY} messages, attributed; the responder quotes them.
 * - **Logged in `ai_*`, shown in the room.** The responder writes the run
 *   log; this writes the answer into an agent message, sent to the room as
 *   it grows.
 * - **Where it runs.** In the background of the request that sent the
 *   mention (`BackgroundTaskProvider`): the same for a page, the CLI and
 *   MCP. On Node it has as long as it needs; on Workers it gets the
 *   `waitUntil` window, about 30 s, and a run cut short is stored as failed.
 *   Recorded in #F1528.
 * - **Limits.** One run per room and member at a time; an agent's message
 *   never starts a run (it never goes through `send`).
 */
export class ChatAgentRunner {
  /**
   * How many earlier messages of the room the agent reads.
   */
  public static readonly HISTORY = 20;

  /**
   * The longest a run may take before it is stopped and stored as failed.
   */
  public static readonly TIMEOUT_MS = 5 * 60 * 1000;

  /**
   * How often a growing answer is sent to the room.
   */
  protected static readonly FLUSH_MS = 400;

  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly messages = $repository(chatMessages);
  protected readonly members = $repository(chatRoomMembers);
  protected readonly registry = $inject(ChatResponderRegistry);
  protected readonly rooms = $inject(ChatRoomService);
  protected readonly audience = $inject(ChatAudience);
  protected readonly live = $inject(ChatLive);
  protected readonly roster = $inject(ProjectRoster);
  protected readonly scope = $inject(McpProjectScope);
  protected readonly background = $inject(BackgroundTaskProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Answer `trigger`, a member's message naming `agent`.
   */
  public async start(
    room: ChatRoom,
    trigger: ChatMessage,
    user: UserAccountToken,
    handle: string,
  ): Promise<void> {
    const match = await this.registry.get(room.projectId, handle);
    if (!match) return;
    const { responder } = match;
    const agent = match.handle;
    const agentId = match.agent?.id;

    if (await this.running(room.id, agent, user.id)) {
      await this.note(
        room,
        agent,
        user.id,
        "failed",
        "I am still answering your last message here: ask again once it is done.",
      );
      return;
    }

    const answer = await this.messages.create({
      roomId: room.id,
      agent,
      ...(agentId ? { agentId } : {}),
      body: "",
      references: [],
      agentRun: { status: "running", mentionerId: user.id },
    });
    await this.publish(room, answer, "message.created");

    const history = await this.history(room, trigger);
    const membership = await this.rooms.membershipOf(room.id, user.id);
    this.detach(room, answer, () =>
      responder.respond({
        projectId: room.projectId,
        roomId: room.id,
        roomName: room.name,
        user,
        prompt: trigger.body,
        history,
        ...(membership?.aiConversationId
          ? { conversationId: membership.aiConversationId }
          : {}),
      }),
    );
  }

  /**
   * The mentioner approves or denies the write the run paused on; nobody
   * else may, as the run is theirs.
   */
  public async decide(
    projectId: number,
    roomId: string,
    messageId: string,
    user: UserAccountToken,
    decision: "approve" | "deny",
  ): Promise<void> {
    const room = await this.rooms.visibleRoom(projectId, roomId, user.id);
    const answer = await this.messages.findOne({
      where: { id: { eq: messageId } },
    });
    if (!answer || answer.roomId !== room.id || !answer.agentRun) {
      throw new NotFoundError("Message not found");
    }
    const run = answer.agentRun;
    if (run.mentionerId !== user.id) {
      throw new ForbiddenError(
        "Only the member who asked the agent decides what it may write",
      );
    }
    if (run.status !== "paused" || !run.callId) {
      throw new ConflictError("This answer is not waiting for a decision");
    }
    const responder = (await this.registry.byMessage(projectId, answer))
      ?.responder;
    const membership = await this.rooms.membershipOf(room.id, user.id);
    if (!responder || !membership?.aiConversationId) {
      throw new ConflictError("This answer can no longer be resumed");
    }
    const resumed = await this.messages.updateById(answer.id, {
      agentRun: { status: "running", mentionerId: user.id },
    });
    await this.publish(room, resumed, "message.updated");
    const conversationId = membership.aiConversationId;
    const callId = run.callId;
    this.detach(room, resumed, () =>
      responder.resume({
        projectId: room.projectId,
        user,
        conversationId,
        callId,
        decision,
      }),
    );
  }

  /**
   * Resolves once every run started so far has stored its last word: what a
   * spec awaits, since runs are detached from the request.
   */
  public async settled(): Promise<void> {
    await this.background.flush();
  }

  /**
   * Run `events` in the background, held to the room's project and given
   * its own clock: the request that started it ends long before it does.
   */
  protected detach(
    room: ChatRoom,
    answer: ChatMessage,
    events: () => AsyncIterable<ChatAgentEvent>,
  ): void {
    this.background.defer(() =>
      this.alepha.context.run(
        () =>
          this.scope.pinned(room.projectId, () =>
            this.drive(room, answer, events()),
          ),
        { signal: AbortSignal.timeout(ChatAgentRunner.TIMEOUT_MS) },
      ),
    );
  }

  /**
   * Consume a run's events into the answer message, sent to the room as it
   * grows, stored at the end. Never throws: a failure is the answer.
   */
  protected async drive(
    room: ChatRoom,
    answer: ChatMessage,
    events: AsyncIterable<ChatAgentEvent>,
  ): Promise<void> {
    const mentionerId = answer.agentRun!.mentionerId;
    let text = answer.body;
    const tools = [...(answer.agentRun?.tools ?? [])];
    let flushed = this.dateTime.nowMillis();
    const finish = async (
      run: NonNullable<ChatMessage["agentRun"]>,
      body: string,
    ) => {
      const stored = await this.messages.updateById(answer.id, {
        body,
        agentRun: { ...run, ...(tools.length ? { tools } : {}) },
      });
      await this.publish(room, stored, "message.updated");
    };
    // Stored as it grows, not only sent: a page reloaded mid-answer reads
    // the text so far, then the frames bring the rest.
    const progress = async () => {
      flushed = this.dateTime.nowMillis();
      const stored = await this.messages.updateById(answer.id, {
        body: text,
        agentRun: {
          status: "running",
          mentionerId,
          ...(tools.length ? { tools } : {}),
        },
      });
      await this.publish(room, stored, "message.updated");
    };

    try {
      for await (const event of events) {
        if (event.type === "conversation") {
          await this.remember(room.id, mentionerId, event.conversationId);
        } else if (event.type === "tool") {
          const last = tools.at(-1);
          if (
            event.state !== "running" &&
            last?.name === event.name &&
            last.state === "running"
          ) {
            last.state = event.state;
          } else {
            tools.push({ name: event.name, state: event.state });
          }
          await progress();
        } else if (event.type === "text") {
          text += event.text;
          if (this.dateTime.nowMillis() - flushed > ChatAgentRunner.FLUSH_MS) {
            await progress();
          }
        } else if (event.type === "confirm") {
          await finish(
            {
              status: "paused",
              mentionerId,
              callId: event.callId,
              tool: event.name,
              input: (event.input ?? {}) as Record<string, unknown>,
            },
            text,
          );
          return;
        } else if (event.type === "error") {
          await finish(
            { status: "failed", mentionerId },
            this.joined(text, `Lore could not finish: ${event.message}`),
          );
          return;
        }
      }
      await finish({ status: "done", mentionerId }, text);
    } catch (error) {
      this.log.warn("A chat agent run failed", { roomId: room.id, error });
      await finish(
        { status: "failed", mentionerId },
        this.joined(
          text,
          `Lore could not finish: ${error instanceof Error ? error.message : "the run stopped"}`,
        ),
      ).catch(() => {});
    }
  }

  protected joined(text: string, line: string): string {
    return text.trim() ? `${text.trimEnd()}\n\n_${line}_` : `_${line}_`;
  }

  /**
   * An answer of the agent's that runs or waits for its mentioner here.
   */
  protected async running(
    roomId: string,
    agent: string,
    mentionerId: string,
  ): Promise<boolean> {
    const recent = await this.messages.findMany({
      where: { roomId: { eq: roomId }, agent: { eq: agent } },
      orderBy: [{ column: "id", direction: "desc" }],
      limit: 20,
    });
    return recent.some(
      (it) =>
        it.agentRun?.mentionerId === mentionerId &&
        (it.agentRun.status === "running" || it.agentRun.status === "paused"),
    );
  }

  /**
   * A one-line answer from the agent, with no run behind it.
   */
  protected async note(
    room: ChatRoom,
    agent: string,
    mentionerId: string,
    status: "failed",
    line: string,
  ): Promise<void> {
    const message = await this.messages.create({
      roomId: room.id,
      agent,
      body: `_${line}_`,
      references: [],
      agentRun: { status, mentionerId },
    });
    await this.publish(room, message, "message.created");
  }

  /**
   * The room's messages before `trigger`, oldest first, attributed. Other
   * rooms, private ones included, are never read.
   */
  protected async history(room: ChatRoom, trigger: ChatMessage) {
    const rows = await this.messages.findMany({
      where: { roomId: { eq: room.id }, id: { lt: trigger.id } },
      orderBy: [{ column: "id", direction: "desc" }],
      limit: ChatAgentRunner.HISTORY,
    });
    const names = new Map(
      (await this.roster.of(room.projectId)).map((it) => [it.userId, it.label]),
    );
    return rows
      .filter((it) => !it.deletedAt && it.body.trim())
      .toReversed()
      .map((it) => ({
        author: it.agent ?? names.get(it.authorId ?? "") ?? "a removed member",
        agent: !!it.agent,
        text: it.body.slice(0, 2000),
      }));
  }

  protected async remember(
    roomId: string,
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const membership = await this.rooms.membershipOf(roomId, userId);
    if (membership && membership.aiConversationId !== conversationId) {
      await this.members.updateById(membership.id, {
        aiConversationId: conversationId,
      });
    }
  }

  protected async publish(
    room: ChatRoom,
    message: ChatMessage,
    type: "message.created" | "message.updated",
  ): Promise<void> {
    const [resource] = await this.alepha
      .inject(ChatMessageService)
      .decorate([message]);
    await this.live.send(await this.audience.of(room), {
      type,
      projectId: room.projectId,
      roomId: room.id,
      message: resource!,
    });
  }
}
