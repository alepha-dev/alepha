import { $audit } from "alepha/api/audits";

/**
 * Authentication & session-security audit events.
 *
 * Holds two audit types:
 * - `auth` — login / logout / token refresh / MFA.
 * - `security` — rate limiting, session invalidation, and related guards.
 *
 * Failed events are logged with `success: false`; severity (`warning`) is
 * derived centrally in `AuditService.create`. Register as a module variant
 * and log via the exposed primitives:
 * `sessionAudits(realm)?.auth.log("login", { success: false, … })`.
 */
export class SessionAudits {
  public readonly auth = $audit({
    type: "auth",
    description: "Authentication events (login, logout, token refresh, MFA).",
    actions: ["login", "logout", "token_refresh", "mfa_setup", "mfa_verify"],
  });

  public readonly security = $audit({
    type: "security",
    description:
      "Security events (rate limiting, session invalidation, blocked access).",
    actions: [
      "rate_limited",
      "sessions_invalidated",
      "permission_denied",
      "blocked",
    ],
  });
}
