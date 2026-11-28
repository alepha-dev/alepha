import { $inject, z } from "alepha";
import { $action, readRawBody, UnauthorizedError } from "alepha/server";

import { GitHubWebhookReceiver } from "../services/GitHubWebhookReceiver.ts";

/**
 * The one public endpoint GitHub posts every delivery of the instance's App
 * to (#Q4360, #Q4364): `POST /api/github/webhook`.
 *
 * No body schema on purpose: the body parser then leaves the stream unread,
 * and the signature is checked over the exact bytes GitHub sent. Everything
 * else is {@link GitHubWebhookReceiver}'s.
 */
export class GitHubWebhookController {
  protected readonly receiver = $inject(GitHubWebhookReceiver);

  public readonly receiveGitHubWebhook = $action({
    method: "POST",
    path: "/github/webhook",
    group: "github",
    description: "GitHub App webhook deliveries, signed with the App's secret",
    schema: {
      headers: z.object({
        "x-hub-signature-256": z.string().optional(),
        "x-github-event": z.string().optional(),
        "x-github-delivery": z.string().optional(),
        "content-length": z.string().optional(),
      }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: async (request) => {
      const body = (await readRawBody(request.raw)) ?? new Uint8Array();
      const answer = await this.receiver.receive({
        body,
        signature: request.headers["x-hub-signature-256"],
        event: request.headers["x-github-event"],
        delivery: request.headers["x-github-delivery"],
      });
      if (answer === "unauthorized") {
        throw new UnauthorizedError("Bad signature");
      }
      request.reply.status = answer === "accepted" ? 202 : 200;
      return { ok: true };
    },
  });
}
