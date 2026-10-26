import { $inject } from "alepha";
import {
  AiContextBlock,
  type AiMessage,
  type AiPendingCall,
  type AiToolCall,
  type AiUsage,
  type AiVendorData,
} from "alepha/ai";
import { $repository } from "alepha/orm";
import { NotFoundError } from "alepha/server";

import {
  type AiConversationEntity,
  aiConversationEntity,
} from "../entities/aiConversationEntity.ts";
import {
  type AiMessageEntity,
  aiMessageEntity,
} from "../entities/aiMessageEntity.ts";
import type { AiConversationResource } from "../schemas/aiConversationResourceSchema.ts";
import type { AiMessageResource } from "../schemas/aiMessageResourceSchema.ts";

/**
 * Conversations and their messages, always through their owner.
 *
 * ⚠️ Every read takes the user id. Another user's conversation is a 404,
 * not a 403, so an endpoint never confirms that an id exists.
 */
export class AiConversationService {
  protected readonly conversations = $repository(aiConversationEntity);
  protected readonly messages = $repository(aiMessageEntity);
  protected readonly contextBlock = $inject(AiContextBlock);

  /**
   * Characters of the first message kept as the title.
   */
  protected readonly titleLength = 100;

  public async create(
    userId: string,
    firstMessage: string,
  ): Promise<AiConversationEntity> {
    const title = firstMessage.trim().replace(/\s+/g, " ");
    return this.conversations.create({
      userId,
      title:
        title.length > this.titleLength
          ? `${title.slice(0, this.titleLength - 3)}...`
          : title,
    });
  }

  /**
   * The conversation, if `userId` owns it.
   *
   * @throws NotFoundError otherwise, whether it exists or not.
   */
  public async owned(
    userId: string,
    id: string,
  ): Promise<AiConversationEntity> {
    const found = await this.conversations.findOne({
      where: { id: { eq: id }, userId: { eq: userId } },
    });
    if (!found) {
      throw new NotFoundError("Conversation not found");
    }
    return found;
  }

  public async list(
    userId: string,
    limit = 50,
  ): Promise<AiConversationEntity[]> {
    return this.conversations.findMany({
      where: { userId: { eq: userId } },
      orderBy: [
        { column: "updatedAt", direction: "desc" },
        { column: "id", direction: "desc" },
      ],
      limit,
    });
  }

  public async rows(conversationId: string): Promise<AiMessageEntity[]> {
    return this.messages.findMany({
      where: { conversationId: { eq: conversationId } },
      orderBy: { column: "seq", direction: "asc" },
    });
  }

  /**
   * The conversation as `$ai` reads it.
   */
  public async history(conversationId: string): Promise<AiMessage[]> {
    return (await this.rows(conversationId)).map((row) => this.toMessage(row));
  }

  /**
   * Store one message after the conversation's last.
   */
  public async append(
    conversation: AiConversationEntity,
    seq: number,
    message: AiMessage,
    extra: { usage?: AiUsage; model?: string } = {},
  ): Promise<void> {
    await this.messages.create({
      conversationId: conversation.id,
      userId: conversation.userId,
      seq,
      role: message.role,
      content: message.content,
      ...(message.role === "assistant"
        ? {
            toolCalls: message.toolCalls?.length
              ? (message.toolCalls as Record<string, any>[])
              : null,
            vendor: (message.vendor as Record<string, any> | undefined) ?? null,
            model: extra.model ?? null,
            inputTokens: extra.usage?.inputTokens ?? 0,
            outputTokens: extra.usage?.outputTokens ?? 0,
          }
        : {}),
      ...(message.role === "tool"
        ? {
            callId: message.callId,
            name: message.name,
            isError: message.isError ?? false,
          }
        : {}),
    });
  }

  /**
   * The `seq` the next message takes.
   */
  public async nextSeq(conversationId: string): Promise<number> {
    const last = await this.messages.findMany({
      where: { conversationId: { eq: conversationId } },
      orderBy: { column: "seq", direction: "desc" },
      limit: 1,
    });
    return (last[0]?.seq ?? -1) + 1;
  }

  /**
   * Record the call a turn paused on.
   */
  public async pause(id: string, pending: AiPendingCall): Promise<void> {
    await this.conversations.updateMany(
      { id: { eq: id } },
      { pendingCallId: pending.callId, pendingCall: { ...pending } },
    );
  }

  /**
   * Claim the pending call for a resume: true for exactly one caller, the
   * one whose conditional update cleared it.
   */
  public async claim(id: string, callId: string): Promise<boolean> {
    const claimed = await this.conversations.updateMany(
      { id: { eq: id }, pendingCallId: { eq: callId } },
      { pendingCallId: null, pendingCall: null },
    );
    return claimed.length === 1;
  }

  /**
   * Mark activity, for the list order and the retention clock.
   */
  public async touch(id: string): Promise<void> {
    await this.conversations.updateMany({ id: { eq: id } }, {});
  }

  /**
   * Tokens `userId` spent since `since` (ISO), input plus output.
   */
  public async tokensSince(userId: string, since: string): Promise<number> {
    const [row] = await this.messages.aggregate({
      select: {
        inputTokens: { sum: true },
        outputTokens: { sum: true },
      },
      where: {
        userId: { eq: userId },
        role: { eq: "assistant" },
        createdAt: { gte: since },
      },
    });
    return (
      Number(row?.inputTokens?.sum ?? 0) + Number(row?.outputTokens?.sum ?? 0)
    );
  }

  /**
   * Delete conversations last active before `cutoff` (ISO), and their
   * messages, a bounded batch at a time.
   */
  public async purge(cutoff: string, limit = 1_000): Promise<number> {
    const stale = await this.conversations.findMany({
      where: { updatedAt: { lt: cutoff } },
      columns: ["id"] as any,
      limit,
    });
    if (stale.length === 0) {
      return 0;
    }
    const ids = stale.map((row) => row.id);
    await this.messages.deleteMany({ conversationId: { inArray: ids } });
    await this.conversations.deleteMany({ id: { inArray: ids } });
    return ids.length;
  }

  public toResource(row: AiConversationEntity): AiConversationResource {
    return {
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      title: row.title ?? undefined,
      pendingCall:
        (row.pendingCall as AiConversationResource["pendingCall"]) ?? undefined,
    };
  }

  public toMessageResource(row: AiMessageEntity): AiMessageResource {
    return {
      id: row.id,
      createdAt: row.createdAt,
      role: row.role,
      content:
        row.role === "user"
          ? this.contextBlock.strip(row.content)
          : row.content,
      toolCalls: (row.toolCalls as AiMessageResource["toolCalls"]) ?? undefined,
      callId: row.callId ?? undefined,
      name: row.name ?? undefined,
      isError: row.isError ?? undefined,
    };
  }

  protected toMessage(row: AiMessageEntity): AiMessage {
    if (row.role === "user") {
      return { role: "user", content: row.content };
    }
    if (row.role === "tool") {
      return {
        role: "tool",
        callId: row.callId ?? "",
        name: row.name ?? "",
        content: row.content,
        ...(row.isError ? { isError: true } : {}),
      };
    }
    return {
      role: "assistant",
      content: row.content,
      ...(row.toolCalls?.length
        ? { toolCalls: row.toolCalls as unknown as AiToolCall[] }
        : {}),
      ...(row.vendor ? { vendor: row.vendor as unknown as AiVendorData } : {}),
    };
  }
}
