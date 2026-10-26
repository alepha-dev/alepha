import { $inject, createMiddleware, type ProvidingMiddleware, z } from "alepha";
import { $rateLimit } from "alepha/rate-limit";
import { $secure, type UserAccountToken } from "alepha/security";
import { $action, $sse } from "alepha/server";

import type { AiConversationEntity } from "../entities/aiConversationEntity.ts";
import { aiChatBodySchema } from "../schemas/aiChatBodySchema.ts";
import { aiConversationDetailSchema } from "../schemas/aiConversationDetailSchema.ts";
import { aiConversationResourceSchema } from "../schemas/aiConversationResourceSchema.ts";
import { aiResumeBodySchema } from "../schemas/aiResumeBodySchema.ts";
import { aiStreamEventSchema } from "../schemas/aiStreamEventSchema.ts";
import { AiBudgetService } from "../services/AiBudgetService.ts";
import { AiChatService } from "../services/AiChatService.ts";
import { AiConversationService } from "../services/AiConversationService.ts";
import { AiSettings } from "../services/AiSettings.ts";

/**
 * The assistant's HTTP surface: chat and resume as `$sse` streams, the
 * conversation list and detail as `$action`s.
 *
 * Every endpoint is `$secure()` and scoped to the caller: another user's
 * conversation is a 404, never a 403. On the streams, every refusal happens
 * in a `use` middleware, before the stream opens, so it is the response's
 * status: 401 anonymous, 404 not yours, 409 not waiting on that call, 429
 * over the turn rate or the token budget.
 */
export class AiController {
  protected readonly url: string = "/ai";
  protected readonly group: string = "ai";
  protected readonly settings = $inject(AiSettings);
  protected readonly chatService = $inject(AiChatService);
  protected readonly conversations = $inject(AiConversationService);
  protected readonly budget = $inject(AiBudgetService);

  /**
   * Turns per minute per user, from the `api.ai` parameter.
   */
  protected readonly turns = $rateLimit({
    name: "api:ai:turns",
    limit: () => this.settings.current.turnsPerMinute,
    window: [1, "minute"],
  });

  public readonly chat = $sse({
    path: `${this.url}/chat`,
    group: this.group,
    description:
      "Send a message to the assistant and stream its turn, in a new conversation or an existing one",
    use: [$secure(), this.perUser(), this.budget.middleware(), this.chatGate()],
    schema: { body: aiChatBodySchema, data: aiStreamEventSchema },
    handler: async ({ body, user, conversation, emit }) => {
      for await (const event of this.chatService.chat(
        conversation,
        user,
        body,
      )) {
        emit(event);
      }
    },
  });

  public readonly resume = $sse({
    path: `${this.url}/conversations/:id/resume`,
    group: this.group,
    description:
      "Answer the call a conversation waits on (approve, deny, or a client tool's result) and stream the rest of the turn",
    use: [
      $secure(),
      this.perUser(),
      this.budget.middleware(),
      this.resumeGate(),
    ],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: aiResumeBodySchema,
      data: aiStreamEventSchema,
    },
    handler: async ({ body, user, conversation, emit }) => {
      for await (const event of this.chatService.resume(
        conversation,
        user,
        this.chatService.toResume(body),
      )) {
        emit(event);
      }
    },
  });

  public readonly listConversations = $action({
    method: "GET",
    path: `${this.url}/conversations`,
    group: this.group,
    description: "The caller's assistant conversations, most recent first",
    use: [$secure()],
    schema: { response: z.array(aiConversationResourceSchema) },
    handler: async ({ user }) =>
      (await this.conversations.list(user.id)).map((row) =>
        this.conversations.toResource(row),
      ),
  });

  public readonly getConversation = $action({
    method: "GET",
    path: `${this.url}/conversations/:id`,
    group: this.group,
    description: "One of the caller's conversations, with its messages",
    use: [$secure()],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: aiConversationDetailSchema,
    },
    handler: async ({ params, user }) => {
      const conversation = await this.conversations.owned(user.id, params.id);
      const rows = await this.conversations.rows(conversation.id);
      return {
        conversation: this.conversations.toResource(conversation),
        messages: rows.map((row) => this.conversations.toMessageResource(row)),
      };
    },
  });

  /**
   * The turn limiter, keyed on the user `$secure()` resolved.
   */
  protected perUser() {
    return this.turns.middleware({
      key: (context: { user: UserAccountToken }) => `user:${context.user.id}`,
    });
  }

  /**
   * Resolve the conversation of a new turn before the stream opens: a 404
   * for one the caller does not own, a 409 for one waiting on a call.
   */
  protected chatGate(): ProvidingMiddleware<{
    conversation: AiConversationEntity;
  }> {
    return createMiddleware({
      name: "aiChatGate",
      handler: ({ next }) => {
        return async (...args: any[]) => {
          const context = args[0];
          context.conversation = await this.chatService.conversationFor(
            context.user.id,
            context.body,
          );
          return next(...args);
        };
      },
    }) as ProvidingMiddleware<{ conversation: AiConversationEntity }>;
  }

  /**
   * Claim the call a resume answers before the stream opens: a 404 for a
   * conversation the caller does not own, a 409 for a call it does not wait
   * on (or one a concurrent resume claimed first).
   */
  protected resumeGate(): ProvidingMiddleware<{
    conversation: AiConversationEntity;
  }> {
    return createMiddleware({
      name: "aiResumeGate",
      handler: ({ next }) => {
        return async (...args: any[]) => {
          const context = args[0];
          // A malformed answer is a 400 here, before the call is claimed.
          this.chatService.toResume(context.body);
          context.conversation = await this.chatService.claim(
            context.user.id,
            context.params.id,
            context.body.callId,
          );
          return next(...args);
        };
      },
    }) as ProvidingMiddleware<{ conversation: AiConversationEntity }>;
  }
}
