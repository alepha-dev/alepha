import { $audit } from "alepha/api/audits";

/**
 * Webhook endpoint audit events, logged by `WebhookEndpointService`: "who
 * pointed our events at that URL" is a security question.
 *
 * Every row names the endpoint and its host, never the URL (it can carry a
 * token) and never a secret.
 */
export class WebhookAudits {
  public readonly endpoint = $audit({
    type: "webhook-endpoint",
    description:
      "Webhook endpoint lifecycle events (create, update, delete, rotate, enable).",
    actions: ["create", "update", "delete", "rotate", "enable"],
  });
}
