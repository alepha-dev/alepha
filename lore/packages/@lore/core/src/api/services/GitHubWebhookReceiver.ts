import { $inject } from "alepha";
import { $rateLimit } from "alepha/rate-limit";

import { GitHubAppService } from "./GitHubAppService.ts";
import { GitHubDeliveryService } from "./GitHubDeliveryService.ts";
import { GitHubWebhookSignature } from "./GitHubWebhookSignature.ts";

/**
 * One delivery as the endpoint received it: raw bytes and GitHub's headers.
 */
export interface GitHubIncomingDelivery {
  body: Uint8Array;
  signature?: string;
  event?: string;
  delivery?: string;
}

/**
 * What the endpoint answers: `unauthorized` is a 401, `invalid` a 400,
 * `limited` a 429, `accepted` a 202, `acknowledged` a 200.
 */
export type GitHubDeliveryAnswer =
  | "unauthorized"
  | "invalid"
  | "limited"
  | "accepted"
  | "acknowledged";

/**
 * Receives a delivery of the instance's App (#Q4360, #Q4364).
 *
 * 1. The signature is checked over the raw bytes before anything is read: a
 *    bad or missing one, or an instance with no App to check it with, is a
 *    401 and nothing else happens.
 * 2. Rate limited per installation, once the signature has passed.
 * 3. Stored under GitHub's GUID (`GitHubDeliveryService.store`), which is the
 *    dedupe, then answered at once: 202 for a stored one, whose handling is
 *    deferred, 200 for a GUID already stored. Nothing slow runs before the
 *    answer; GitHub gives up after 10 s.
 *
 * GitHub's `ping`, sent when the App is created, also records that the
 * webhook URL is reachable.
 */
export class GitHubWebhookReceiver {
  protected readonly apps = $inject(GitHubAppService);
  protected readonly signatures = $inject(GitHubWebhookSignature);
  protected readonly deliveries = $inject(GitHubDeliveryService);

  /**
   * Deliveries per installation per minute: far above a busy repository's
   * pace, and a ceiling for a flood signed with a leaked secret.
   */
  protected readonly limit = $rateLimit({
    name: "lore:github-webhook",
    limit: 600,
    window: 60_000,
    key: (input: { installation: string }) => input.installation,
  });

  async receive(input: GitHubIncomingDelivery): Promise<GitHubDeliveryAnswer> {
    const app = await this.apps.credentials();
    if (
      !app ||
      !(await this.signatures.verify(
        input.body,
        input.signature,
        app.webhookSecret,
      ))
    ) {
      return "unauthorized";
    }
    const event = input.event?.trim();
    const delivery = input.delivery?.trim();
    if (!event || !delivery || !/^[A-Za-z0-9-]{1,64}$/.test(delivery)) {
      return "invalid";
    }
    const allowed = await this.limit.consume({
      installation: this.installationOf(input.body) ?? "none",
    });
    if (!allowed.allowed) return "limited";
    if (event === "ping") await this.apps.recordPing();
    const stored = await this.deliveries.store({
      delivery,
      event,
      body: input.body,
    });
    return stored === "duplicate" || event === "ping"
      ? "acknowledged"
      : "accepted";
  }

  /**
   * The installation id, read cheaply for the rate limit's key: the first
   * `"installation":{"id":N` of the body, or none.
   */
  protected installationOf(body: Uint8Array): string | undefined {
    if (body.byteLength > GitHubDeliveryService.MAX_BYTES) return undefined;
    const text = new TextDecoder().decode(body);
    return /"installation"\s*:\s*\{\s*"id"\s*:\s*(\d{1,20})/.exec(text)?.[1];
  }
}
