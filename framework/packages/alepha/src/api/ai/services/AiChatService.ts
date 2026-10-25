import { $inject, Alepha, AlephaError } from "alepha";
import {
  $ai,
  type AiMessage,
  type AiPrimitive,
  type AiResume,
  type AiTurnEvent,
} from "alepha/ai";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError } from "alepha/server";

import type { AiConversationEntity } from "../entities/aiConversationEntity.ts";
import { AiCallMismatchError } from "../errors/AiCallMismatchError.ts";
import type { AiChatBody } from "../schemas/aiChatBodySchema.ts";
import type { AiResumeBody } from "../schemas/aiResumeBodySchema.ts";
import type { AiStreamEvent } from "../schemas/aiStreamEventSchema.ts";
import { AiConversationService } from "./AiConversationService.ts";

/**
 * Drives one step of a conversation through the app's `$ai`, persisting
 * every message as it completes and recording a pause.
 *
 * The assistant is the app's own `$ai`: the only one, or the one a request
 * names when the app declares several. This module brings the storage and
 * the endpoints, never the prompt or the tools.
 */
export class AiChatService {
  protected readonly alepha = $inject(Alepha);
  protected readonly conversations = $inject(AiConversationService);

  /**
   * The `$ai` a request talks to.
   *
   * @throws BadRequestError when the name matches none, or when the app
   * declares several and the request names none.
   */
  public assistant(name?: string): AiPrimitive {
    const all = this.alepha.primitives($ai);
    if (name) {
      const found = all.find((ai) => ai.name === name);
      if (!found) {
        throw new BadRequestError(`Unknown assistant '${name}'`);
      }
      return found;
    }
    if (all.length === 1) {
      return all[0];
    }
    if (all.length === 0) {
      throw new AlephaError(
        "alepha/api/ai needs a $ai declared in the app: none is registered.",
      );
    }
    throw new BadRequestError(
      `This app declares ${all.length} assistants: name one (${all.map((ai) => ai.name).join(", ")})`,
    );
  }

  /**
   * The conversation a new turn goes to: the named one if `userId` owns it
   * and it waits on nothing, else a new one.
   *
   * @throws NotFoundError for a conversation `userId` does not own.
   * @throws AiCallMismatchError for one waiting on a call.
   */
  public async conversationFor(
    userId: string,
    body: AiChatBody,
  ): Promise<AiConversationEntity> {
    if (!body.conversationId) {
      return this.conversations.create(userId, body.message);
    }
    const conversation = await this.conversations.owned(
      userId,
      body.conversationId,
    );
    if (conversation.pendingCallId) {
      throw new AiCallMismatchError(
        "This conversation waits on a call: answer it before a new message",
      );
    }
    return conversation;
  }

  /**
   * Claim a paused conversation's call for a resume.
   *
   * @throws NotFoundError for a conversation `userId` does not own.
   * @throws AiCallMismatchError when it does not wait on `callId`, or a
   * concurrent resume claimed it first.
   */
  public async claim(
    userId: string,
    id: string,
    callId: string,
  ): Promise<AiConversationEntity> {
    const conversation = await this.conversations.owned(userId, id);
    if (!(await this.conversations.claim(id, callId))) {
      throw new AiCallMismatchError();
    }
    return conversation;
  }

  /**
   * One new turn in `conversation`.
   */
  public async *chat(
    conversation: AiConversationEntity,
    user: UserAccountToken,
    body: AiChatBody,
  ): AsyncIterable<AiStreamEvent> {
    yield { type: "conversation", conversationId: conversation.id };
    const assistant = this.assistant(body.assistant);
    const history = await this.conversations.history(conversation.id);
    let seq = await this.conversations.nextSeq(conversation.id);
    const message: AiMessage = { role: "user", content: body.message };

    // With a context, `$ai` emits the user's message augmented with it, and
    // that is what gets stored; without one it emits nothing for it.
    if (!body.context) {
      await this.conversations.append(conversation, seq++, message);
    }

    yield* this.drive(
      conversation,
      seq,
      assistant.stream({
        messages: [...history, message],
        context: body.context,
        user,
      }),
    );
  }

  /**
   * The resume a request body asks for.
   *
   * @throws BadRequestError unless it carries exactly one of `decision` and
   * `result`.
   */
  public toResume(body: AiResumeBody): AiResume {
    const hasResult = "result" in body && body.result !== undefined;
    if (body.decision && !hasResult) {
      return { callId: body.callId, decision: body.decision };
    }
    if (hasResult && !body.decision) {
      return { callId: body.callId, result: body.result };
    }
    throw new BadRequestError(
      "A resume carries exactly one of 'decision' and 'result'",
    );
  }

  /**
   * Continue a claimed conversation from its stored messages.
   */
  public async *resume(
    conversation: AiConversationEntity,
    user: UserAccountToken,
    resume: AiResume,
    assistantName?: string,
  ): AsyncIterable<AiStreamEvent> {
    yield { type: "conversation", conversationId: conversation.id };
    const assistant = this.assistant(assistantName);
    const history = await this.conversations.history(conversation.id);
    const seq = await this.conversations.nextSeq(conversation.id);
    yield* this.drive(
      conversation,
      seq,
      assistant.stream({ messages: history, user, resume }),
    );
  }

  /**
   * Persist and translate a turn's events. A failure after the stream
   * opened becomes an `error` event, then `end`.
   */
  protected async *drive(
    conversation: AiConversationEntity,
    seq: number,
    events: AsyncIterable<AiTurnEvent>,
  ): AsyncIterable<AiStreamEvent> {
    try {
      for await (const event of events) {
        if (event.type === "message") {
          await this.conversations.append(conversation, seq++, event.message, {
            usage: event.usage,
            model: event.model,
          });
          if (event.message.role === "tool") {
            yield {
              type: "tool_result",
              callId: event.message.callId,
              name: event.message.name,
              isError: event.message.isError ?? false,
            };
          }
        } else if (event.type === "text") {
          yield { type: "text", text: event.text };
        } else if (event.type === "tool_call") {
          yield { type: "tool_call", callId: event.callId, name: event.name };
        } else if (event.type === "confirm" || event.type === "client_tool") {
          await this.conversations.pause(conversation.id, {
            callId: event.callId,
            name: event.name,
            input: event.input,
            kind: event.type,
          });
          yield {
            type: event.type,
            callId: event.callId,
            name: event.name,
            input: event.input,
          };
        } else if (event.type === "end") {
          await this.conversations.touch(conversation.id);
          yield {
            type: "end",
            reason: event.reason === "tool" ? "stop" : event.reason,
          };
        }
      }
    } catch (error) {
      await this.conversations.touch(conversation.id);
      yield {
        type: "error",
        name: error instanceof Error ? error.name : "Error",
        message: (error instanceof Error ? error.message : String(error)).slice(
          0,
          1000,
        ),
      };
      yield { type: "end", reason: "stop" };
    }
  }
}
