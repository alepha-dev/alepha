import { $audit } from "alepha/api/audits";

/**
 * API key lifecycle audit events, logged by `ApiKeyService`.
 *
 * Every row carries the key's id and name and who acted, never the token nor
 * its hash. Per-request usage is not audited: `lastUsedAt` and `usageCount`
 * exist for that, and a row per authenticated request would bring back, in a
 * bigger table, the write per request the usage throttle removed.
 */
export class ApiKeyAudits {
  /**
   * `create`, `rotate` and `revoke` are a person acting on a key, the owner or
   * (for `revoke`) an admin, and say which. `purge` is the retention job: one
   * row per run that deleted anything, with the count per window.
   *
   * Kept two years whatever the global default: the record of a credential's
   * creation must outlive the 90-day default by as long as an incident
   * investigation might take to come looking.
   */
  public readonly apiKey = $audit({
    type: "api-key",
    description: "API key lifecycle events (create, rotate, revoke, purge).",
    actions: ["create", "rotate", "revoke", "purge"],
    retentionDays: 730,
  });
}
