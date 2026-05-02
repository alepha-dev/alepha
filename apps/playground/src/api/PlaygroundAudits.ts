import { $audit } from "alepha/api/audits";

/**
 * Audit types exercised by the audits playground page.
 */
export class PlaygroundAudits {
  public readonly auth = $audit({
    type: "auth",
    description: "Authentication-related audit events.",
    actions: ["login", "logout", "failed-login"],
  });

  public readonly orders = $audit({
    type: "orders",
    description: "Order lifecycle audit events.",
    actions: ["create", "update", "cancel"],
  });

  public readonly security = $audit({
    type: "security",
    description: "Security-sensitive audit events.",
    actions: ["permission-grant", "permission-revoke", "access-denied"],
  });
}
