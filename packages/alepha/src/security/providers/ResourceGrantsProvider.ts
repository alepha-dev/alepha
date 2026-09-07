import type { UserAccountToken } from "../interfaces/UserAccountToken.ts";

/**
 * The seam between {@link $owns} and whatever decides what a member may do
 * INSIDE the resource they belong to.
 *
 * `$owns` answers a boolean: are you the owner of this row, or a member of it
 * through the join. That is the whole question for most applications, and for
 * those this provider is never replaced and never costs anything.
 *
 * An application that gives its members different powers - a viewer, a
 * contributor, an administrator - needs a second answer, and it needs it from
 * the same gate: a rule split across a middleware and a hand-written check in
 * the handler is a rule with two versions of itself. `requires` on
 * {@link OwnsOptions} names the permission at the call site, and this provider
 * is what turns the rows the gate already read into an allow or a deny.
 *
 * ## Rows, never ids
 *
 * {@link ResourceGrantsRequest} carries the **authority row** and the
 * **membership row** the gate loaded, not their ids. That is deliberate and it
 * is the whole performance contract: an implementation cannot go and query for
 * the assignment, because it was never handed anything to query with. The
 * assignment has to be a column on a row the gate already reads, so a plain
 * member costs zero extra reads per request.
 *
 * ## The default is today's behaviour
 *
 * Allow. An application that never registers a replacement behaves exactly as
 * it did before `requires` existed, whether or not its call sites use the
 * option. Substitute it the way every other seam in this framework is
 * substituted:
 *
 * ```ts
 * alepha.with({ provide: ResourceGrantsProvider, use: RankGrantsProvider });
 * ```
 */
export class ResourceGrantsProvider {
  /**
   * Decide whether this caller holds every permission in
   * {@link ResourceGrantsRequest.requires} inside this resource.
   *
   * The default answers allow unconditionally: membership alone is the whole
   * grant, which is what `$owns` meant before this seam existed.
   */
  public async check(
    _request: ResourceGrantsRequest,
  ): Promise<ResourceGrantsDecision> {
    return { allowed: true };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Everything an implementation is given, and everything it is allowed to
 * decide from.
 */
export interface ResourceGrantsRequest {
  /**
   * The authenticated caller, after `$secure`'s own issuer, role and
   * permission checks have passed.
   *
   * A permission named in `requires` has ALREADY been checked at application
   * scope by the time this runs, because `$owns` folds it into
   * `secure.permissions`. This provider narrows that answer; it never widens
   * it.
   */
  user: UserAccountToken;

  /**
   * The row the gate decided against - the resource itself, or the row a
   * `through` chain landed on.
   */
  authority: Record<string, unknown>;

  /**
   * The join row linking this caller to {@link authority}, when the gate read
   * one.
   *
   * Absent when the gate has no `via`, and when the caller passed on the
   * `owner` column alone with nothing requiring a rank. Present for an owner
   * too whenever `requires` is set, because that is where an assignment lives
   * and the owner is a member like any other.
   */
  membership?: Record<string, unknown>;

  /**
   * The permissions the call site named, always as a list.
   *
   * An AND: every one of them must be granted.
   */
  requires: string[];
}

/**
 * Allow, or deny with a reason.
 *
 * The message is the implementation's to write, because it is the only party
 * that knows WHICH conjunct failed. A gate that always said "forbidden" would
 * send a member to ask for a better rank when the real answer is that the
 * whole feature is switched off for this resource.
 */
export type ResourceGrantsDecision =
  | { allowed: true }
  | { allowed: false; message?: string };
