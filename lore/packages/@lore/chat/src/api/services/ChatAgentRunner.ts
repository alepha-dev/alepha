import { McpProjectScope, ProjectRoster } from "@lore/core/api";
import { $inject, Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { ConflictError, ForbiddenError, NotFoundError } from "alepha/server";

import { chatAgents } from "../entities/chatAgents.ts";
import { type ChatMessage, chatMessages } from "../entities/chatMessages.ts";
import {
  type ChatRoomMember,
  chatRoomMembers,
} from "../entities/chatRoomMembers.ts";
import type { ChatRoom } from "../entities/chatRooms.ts";
import { ChatAudience } from "./ChatAudience.ts";
import { ChatLive } from "./ChatLive.ts";
import { ChatMessageService } from "./ChatMessageService.ts";
import {
  type ChatAgentEvent,
  type ChatAgentMatch,
  type ChatAgentPersona,
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
  protected readonly agents = $repository(chatAgents);
  protected readonly registry = $inject(ChatResponderRegistry);
  protected readonly rooms = $inject(ChatRoomService);
  protected readonly audience = $inject(ChatAudience);
  protected readonly live = $inject(ChatLive);
  protected readonly roster = $inject(ProjectRoster);
  protected readonly scope = $inject(McpProjectScope);
  protected readonly background = $inject(BackgroundTaskProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * Answer `trigger`, a member's message naming `handle`.
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
    const key = ChatAgentRunner.keyOf(match);

    if (await this.running(room.id, key, user.id)) {
      await this.note(
        room,
        { agent, agentId },
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
    const conversationId = this.conversationOf(membership, key);
    const persona = ChatAgentRunner.personaOf(match);
    this.detach(room, answer, this.nameOf(match), () =>
      responder.respond({
        projectId: room.projectId,
        roomId: room.id,
        roomName: room.name,
        user,
        prompt: trigger.body,
        history,
        ...(conversationId ? { conversationId } : {}),
        ...(persona ? { agent: persona } : {}),
      }),
    );
  }

  /**
   * The mentioner approves or denies the write the run paused on; nobody
   * else may, as the run is theirs. The resume is the same agent's: its
   * playbook and model, read from the answer's `agentId`, even once the
   * agent was renamed.
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
    const match = await this.registry.byMessage(projectId, answer);
    const membership = await this.rooms.membershipOf(room.id, user.id);
    const conversationId = match
      ? this.conversationOf(membership, ChatAgentRunner.keyOf(match))
      : undefined;
    if (!match || !conversationId) {
      throw new ConflictError("This answer can no longer be resumed");
    }
    const resumed = await this.messages.updateById(answer.id, {
      agentRun: { status: "running", mentionerId: user.id },
    });
    await this.publish(room, resumed, "message.updated");
    const callId = run.callId;
    const persona = ChatAgentRunner.personaOf(match);
    this.detach(room, resumed, this.nameOf(match), () =>
      match.responder.resume({
        projectId: room.projectId,
        user,
        conversationId,
        callId,
        decision,
        ...(persona ? { agent: persona } : {}),
      }),
    );
  }

  /**
   * The key an agent's run log is kept under on a membership: `lore`, or
   * the project agent's id, which a rename does not change.
   */
  public static keyOf(match: ChatAgentMatch): string {
    return match.agent?.id ?? match.handle;
  }

  protected static personaOf(
    match: ChatAgentMatch,
  ): ChatAgentPersona | undefined {
    const agent = match.agent;
    if (!agent) return undefined;
    return {
      id: agent.id,
      name: agent.name,
      instructions: agent.prePrompt,
      ...(agent.model ? { model: agent.model } : {}),
      ...(agent.tools?.length ? { tools: agent.tools } : {}),
    };
  }

  /**
   * What the room calls the agent in a line of its own: `Jarvis`, `Lore`.
   */
  protected nameOf(match: ChatAgentMatch): string {
    return match.agent?.name ?? match.responder.label;
  }

  protected conversationOf(
    membership: ChatRoomMember | undefined,
    key: string,
  ): string | undefined {
    return membership?.aiConversations?.[key];
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
    name: string,
    events: () => AsyncIterable<ChatAgentEvent>,
  ): void {
    this.background.defer(() =>
      this.alepha.context.run(
        () =>
          this.scope.pinned(room.projectId, () =>
            this.drive(room, answer, name, events()),
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
    name: string,
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

    // Whether the model said anything after its last tool call: a turn that
    // ends on a failed tool and no word since stopped without finishing.
    let spokeSinceTool = true;
    // The last failed call's error, and how the turn ended (#Q4302).
    let toolError: string | undefined;
    let declined = false;
    let endReason: "stop" | "length" | "paused" | undefined;
    try {
      for await (const event of events) {
        if (event.type === "conversation") {
          await this.remember(
            room.id,
            mentionerId,
            answer.agentId ?? answer.agent ?? "",
            event.conversationId,
          );
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
          if (event.state === "failed") {
            toolError = event.declined ? undefined : event.error;
            declined = event.declined === true;
          }
          spokeSinceTool = false;
          await progress();
        } else if (event.type === "end") {
          endReason = event.reason;
        } else if (event.type === "text") {
          text += event.text;
          if (event.text.trim()) spokeSinceTool = true;
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
          this.report(
            room,
            name,
            ChatAgentRunner.causeOf(event.message),
            event.message,
          );
          await finish(
            { status: "failed", mentionerId },
            this.joined(text, `${name} could not finish: ${event.message}`),
          );
          return;
        }
      }
      // An answer never ends silent (#Q4302): on a failed or declined call
      // with no word after it, or on a reply cut before it said anything,
      // the room is told what happened, as a failed run is.
      const failed = tools.at(-1);
      if (!spokeSinceTool && failed?.state === "failed") {
        this.report(
          room,
          name,
          "tool",
          `${failed.name} failed and the answer ended there`,
        );
        text = this.joined(
          text,
          declined
            ? `${name} stopped: you declined ${failed.name}.`
            : `${name} stopped after ${failed.name} failed${toolError ? `: ${toolError}` : "."}`,
        );
      } else if (endReason === "length" && !text.trim()) {
        this.report(room, name, "length", "the answer ran out of room");
        text = this.joined(text, `${name} ran out of room before answering.`);
      }
      await finish({ status: "done", mentionerId }, text);
    } catch (error) {
      this.report(
        room,
        name,
        ChatAgentRunner.causeOf(error),
        error instanceof Error ? error.message : "the run stopped",
      );
      await finish(
        { status: "failed", mentionerId },
        this.joined(
          text,
          `${name} could not finish: ${error instanceof Error ? error.message : "the run stopped"}`,
        ),
      ).catch(() => {});
    }
  }

  /**
   * How a chat agent's turn fails to finish (#Q4298), each one reported:
   *
   * - `budget`: the mentioner's or the project's AI budget is spent, before
   *   the model is asked or while it answers.
   * - `timeout`: the run outlived {@link TIMEOUT_MS}, or a Worker's
   *   `waitUntil` window, and was stopped.
   * - `provider`: the model's provider refused or failed, or anything else
   *   that stopped the run (a client-only tool, a thrown error).
   * - `tool`: a tool call failed and the turn ended there, with no word
   *   after it, which is a run that stopped as surely as a thrown one.
   */
  public static causeOf(failure: unknown): "budget" | "timeout" | "provider" {
    const message =
      failure instanceof Error
        ? failure.message
        : typeof failure === "string"
          ? failure
          : "";
    const kind = failure instanceof Error ? failure.name : "";
    if (/budget/i.test(message) || kind === "AiBudgetExceededError") {
      return "budget";
    }
    if (
      kind === "TimeoutError" ||
      kind === "AbortError" ||
      /timed? ?out|aborted/i.test(message)
    ) {
      return "timeout";
    }
    return "provider";
  }

  /**
   * Tell the project a chat agent failed to finish (#Q4298): logged at error
   * level, which the app's sigil reports as a server error, so it lands in
   * the errors inbox with the room, the agent and the cause, rather than
   * only as a line in a room nobody may be reading. A plain message, not the
   * `Error`: the sigil would read the error's own message and lose which
   * room and agent it was.
   */
  protected report(
    room: ChatRoom,
    agent: string,
    cause: "budget" | "timeout" | "provider" | "tool" | "length",
    detail: string,
  ): void {
    this.log.error(
      `Chat agent ${agent} could not finish (${cause}) in room ${room.name}: ${detail}`.slice(
        0,
        1000,
      ),
      {
        projectId: room.projectId,
        roomId: room.id,
        room: room.name,
        agent,
        cause,
      },
    );
  }

  protected joined(text: string, line: string): string {
    return text.trim() ? `${text.trimEnd()}\n\n_${line}_` : `_${line}_`;
  }

  /**
   * An answer of the agent's that runs or waits for its mentioner here,
   * keyed on the agent's id (a built-in's handle), so a renamed agent is
   * still the same one.
   */
  protected async running(
    roomId: string,
    key: string,
    mentionerId: string,
  ): Promise<boolean> {
    const recent = await this.messages.findMany({
      where: { roomId: { eq: roomId }, agent: { isNotNull: true } },
      orderBy: [{ column: "id", direction: "desc" }],
      limit: 40,
    });
    return recent.some(
      (it) =>
        (it.agentId ?? it.agent) === key &&
        it.agentRun?.mentionerId === mentionerId &&
        (it.agentRun.status === "running" || it.agentRun.status === "paused"),
    );
  }

  /**
   * A one-line answer from the agent, with no run behind it.
   */
  protected async note(
    room: ChatRoom,
    by: { agent: string; agentId?: string },
    mentionerId: string,
    status: "failed",
    line: string,
  ): Promise<void> {
    const message = await this.messages.create({
      roomId: room.id,
      agent: by.agent,
      ...(by.agentId ? { agentId: by.agentId } : {}),
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
    // A project agent's answers are signed with its current name.
    const agentIds = [
      ...new Set(rows.flatMap((it) => (it.agentId ? [it.agentId] : []))),
    ];
    const agentNames = new Map(
      agentIds.length
        ? (
            await this.agents.findMany({
              where: { id: { inArray: agentIds } },
              columns: ["id", "name"],
            })
          ).map((it) => [it.id, it.name])
        : [],
    );
    return rows
      .filter((it) => !it.deletedAt && it.body.trim())
      .toReversed()
      .map((it) => ({
        author:
          (it.agentId ? agentNames.get(it.agentId) : undefined) ??
          it.agent ??
          names.get(it.authorId ?? "") ??
          "a removed member",
        agent: !!it.agent,
        text: it.body.slice(0, 2000),
      }));
  }

  protected async remember(
    roomId: string,
    userId: string,
    key: string,
    conversationId: string,
  ): Promise<void> {
    const membership = await this.rooms.membershipOf(roomId, userId);
    if (membership && membership.aiConversations?.[key] !== conversationId) {
      await this.members.updateById(membership.id, {
        aiConversations: {
          ...membership.aiConversations,
          [key]: conversationId,
        },
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
