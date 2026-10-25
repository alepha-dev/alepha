/**
 * The one thing in this package that talks to the network.
 *
 * Split out so the channel can be tested whole without `vi.mock`: a spec
 * substitutes {@link MemoryDiscordTransport} through the container and
 * asserts on what would have been posted.
 */
export abstract class DiscordTransport {
  /**
   * POST one message to an incoming webhook.
   *
   * Throwing is how a failure is reported. There is no retry here on
   * purpose: `sendNotification` already retries three times, and a second
   * backoff inside the transport would multiply the two.
   */
  abstract post(webhook: string, payload: DiscordWebhookPayload): Promise<void>;
}

/**
 * Discord's incoming-webhook body, in Discord's own spelling.
 *
 * Deliberately the wire shape rather than a friendlier one: it is written in
 * exactly one place, and a translation layer over four fields would only hide
 * which of them Discord actually accepts.
 */
export interface DiscordWebhookPayload {
  content: string;
  username?: string;
  avatar_url?: string;
}
