import { $audit } from "alepha/api/audits";
import type { UserAccountToken } from "alepha/security";

/**
 * The domain events Lore records in the audit log.
 *
 * Lore turns the audits module on (`AppSecurityProvider`) but declared no
 * `$audit` type of its own, so every row in production came from the
 * framework's auth and user events: nothing Lore did to its own data was
 * recorded, and `/admin/audits` could not answer "who deleted that project".
 *
 * ## What is in, and what is deliberately out
 *
 * The bar is **an action a project owner would want to reconstruct months
 * later**, not every write. What that excludes is as much of the design as
 * what it includes:
 *
 * - **Quests and folios are absent.** Both already carry their own history,
 *   shown on the entity itself where somebody looking for it will actually
 *   be. Duplicating them here buys noise and a second thing to keep true.
 * - **Updates are mostly absent.** A rename is recoverable and visible; a
 *   deletion is neither. `sigil` is the exception, because a rotation is a
 *   credential event.
 *
 * ## One type per domain, not one `lore` type
 *
 * The admin filter offers `type:action` pairs (#1671), so a single type would
 * put `create` in the dropdown once, meaning five different things. Five
 * types put `project:create` and `sigil:create` there as separate entries,
 * which is the question an operator is actually asking.
 *
 * ## Retention
 *
 * Only `sigil` sets one. Credential events are what you go back through after
 * a leak, and "how long ago was that token rotated" is a question with a long
 * tail, so they keep 730 days against the global default. The rest inherit
 * it: a project deletion nobody asked about within the default window is not
 * a question that arrives later.
 */
export class LoreAudits {
  /**
   * ⚠️ `transfer` is NOT declared. `leaveProject` says outright that
   * ownership transfer is not implemented, and an action nobody can perform
   * would sit in the admin filter promising rows that cannot exist.
   */
  readonly project = $audit({
    type: "project",
    description: "Project lifecycle",
    actions: ["create", "delete"],
  });

  /**
   * `join` and `leave` rather than `add` and `remove`, because both sides
   * exist: a member joins by accepting an invitation, and leaves either by
   * their own hand (`leaveProject`) or the owner's (`removeMember`, #1695).
   * Who did it is the actor on the row, which is what tells the two apart.
   */
  readonly member = $audit({
    type: "member",
    description: "Project membership",
    actions: ["join", "leave"],
  });

  /**
   * A sigil IS a credential: its token is what an enrolled app authenticates
   * with. `rotate` is the one update in this file for that reason, and the
   * retention is the longest for the same one.
   */
  readonly sigil = $audit({
    type: "sigil",
    description: "App enrolment credentials",
    actions: ["create", "rotate", "delete"],
    retentionDays: 730,
  });

  /**
   * Publishing is one-way and freezes the record, so it is exactly the kind
   * of thing somebody comes back to. `reopen` is its undo and belongs beside
   * it: a release that was published, reopened and published again reads as
   * one event without it.
   */
  readonly release = $audit({
    type: "release",
    description: "Release publication",
    actions: ["publish", "reopen"],
  });

  /**
   * Triage decisions, which are the owner's judgement rather than a data
   * change: the row survives either way, and what is worth recording is who
   * decided and when.
   */
  readonly feedback = $audit({
    type: "feedback",
    description: "Feedback triage",
    actions: ["accept", "reject"],
  });

  /**
   * The three identity fields every row here carries, from the caller's
   * token.
   *
   * `email` and `realm` are optional on `UserAccountToken`, so this hands
   * back what is there rather than asserting a shape. The id alone survives
   * a user deletion as a reference to nothing, which is why the email is
   * copied onto the row instead of joined at read time.
   */
  actor(user: UserAccountToken | undefined): {
    userId?: string;
    userEmail?: string;
    userRealm?: string;
  } {
    if (!user) return {};
    return {
      userId: user.id,
      userEmail: user.email,
      userRealm: user.realm,
    };
  }
}
