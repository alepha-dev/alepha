import { $inject } from "alepha";

import { GitHubAppService } from "./GitHubAppService.ts";
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
 * What the endpoint answers: `unauthorized` is a 401, `accepted` a 202,
 * `acknowledged` a 200.
 */
export type GitHubDeliveryAnswer = "unauthorized" | "accepted" | "acknowledged";

/**
 * Receives a delivery of the instance's App (#Q4360).
 *
 * The signature is checked over the raw bytes before anything is read: a bad
 * or missing one, or an instance with no App to check it with, is a 401 and
 * nothing else happens. GitHub's `ping`, sent when the App is created,
 * records that the webhook URL is reachable.
 */
export class GitHubWebhookReceiver {
  protected readonly apps = $inject(GitHubAppService);
  protected readonly signatures = $inject(GitHubWebhookSignature);

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
    if (input.event === "ping") {
      await this.apps.recordPing();
      return "acknowledged";
    }
    return "accepted";
  }
}
