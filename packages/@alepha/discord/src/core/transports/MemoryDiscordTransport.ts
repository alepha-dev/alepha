import {
  DiscordTransport,
  type DiscordWebhookPayload,
} from "./DiscordTransport.ts";

/**
 * An in-memory transport, for specs and for a local run with no webhook.
 *
 * Substituted the way every other memory provider in the framework is:
 *
 * ```ts
 * Alepha.create()
 *   .with({ provide: DiscordTransport, use: MemoryDiscordTransport })
 *   .with(AlephaDiscordNotifications);
 * ```
 */
export class MemoryDiscordTransport extends DiscordTransport {
  /**
   * Everything that would have been posted, oldest first.
   */
  public readonly posts: Array<{
    webhook: string;
    payload: DiscordWebhookPayload;
  }> = [];

  /**
   * When set, the next post throws with this message. For the spec that
   * proves a refused send reaches the notification job's retry rather than
   * being swallowed.
   */
  public failWith?: string;

  public async post(
    webhook: string,
    payload: DiscordWebhookPayload,
  ): Promise<void> {
    if (this.failWith) {
      throw new Error(this.failWith);
    }
    this.posts.push({ webhook, payload });
  }

  public wasPostedTo(webhook: string): boolean {
    return this.posts.some((post) => post.webhook === webhook);
  }

  public wasPostedMatching(pattern: RegExp): boolean {
    return this.posts.some((post) => pattern.test(post.payload.content));
  }

  public last():
    | { webhook: string; payload: DiscordWebhookPayload }
    | undefined {
    return this.posts[this.posts.length - 1];
  }

  public clear(): void {
    this.posts.length = 0;
  }
}
