import { $inject, type Async, createPrimitive, KIND, Primitive } from "alepha";
import type { UserAccountToken } from "alepha/security";

import { RankResourceProvider } from "../providers/RankResourceProvider.ts";

/**
 * Everything this module does NOT know about the thing a rank is held inside.
 *
 * A rank is a permission set someone holds within one scope: a project, a
 * club, a workspace. What that scope IS, where the assignment is stored and
 * who may edit the ranks are all the application's, and they are the
 * questions below. Arranged the way `$invitationResource` hands closures to
 * `alepha/api/invitations`: the module that owns the decision must not import
 * the application, so the application hands it functions.
 */
export interface RankResourcePrimitiveOptions {
  /**
   * The kind of scope this declaration answers for, e.g. `"project"`. One
   * declaration per type; a second for the same type is refused at boot
   * rather than silently shadowing the first.
   */
  type: string;

  /**
   * Which scope the rows in hand belong to, as a string.
   *
   * ⚠️ **A constant is a legitimate answer**, and for a single-tenant
   * application it is the right one: `() => "club"`. What must never happen
   * is modelling "one scope" as an absent scope - see the note on
   * `rankDefinitions.scopeId`.
   *
   * Answer `undefined` when the rows are not this resource's shape at all.
   * That is how an application with two rank resources tells them apart, and
   * how a gate outside any rank scope says so.
   */
  scope: (rows: RankRows) => string | undefined;

  /**
   * The rank key this caller holds, read off a row the application has
   * already loaded.
   *
   * ⚠️ **This must not query.** The whole performance contract of the module
   * is that an assignment is a column on a row the request already pays for:
   * the membership row a resource gate loaded, or the user row the session
   * was built from. It is synchronous for exactly that reason - there is
   * nowhere to await.
   *
   * `undefined` means "holds no rank here", which is not the same as holding
   * an empty one: the caller is treated as outside the rank system and the
   * module allows, leaving the answer to whatever gate already ran.
   */
  rank: (rows: RankRows) => string | undefined;

  /**
   * The ranks that exist without anybody creating them.
   *
   * They live here rather than as rows, so a scope that never touches its
   * ranks stores nothing. They are **non-removable**, and an attempt to
   * rewrite one is refused rather than accepted and then silently reset from
   * code on the next boot - which is the failure mode this rule exists to
   * avoid, where an administrator's edits vanish with no explanation.
   */
  builtins: RankBuiltin[];

  /**
   * Permissions no rank may ever be granted, whatever the writer holds.
   *
   * The ceiling. For acts that belong to the scope's owner structurally -
   * deleting the scope, changing what it can do at all - where "an
   * administrator is trusted" is not the right answer, because the act
   * widens every rank at once including the actor's own.
   */
  ownerOnly?: string[];

  /**
   * Permissions every rank holds, whether or not its definition lists them.
   *
   * The floor. A member whose rank cannot open the scope is a removal
   * expressed badly, and removal already says it properly. A definition that
   * omits one of these is refused on write, so the matrix and the resolver
   * cannot disagree about it.
   */
  floor?: string[];

  /**
   * The permission that authorises editing ranks in this scope.
   *
   * Named so the module can refuse a self-lockout: dropping it from your own
   * rank leaves a scope whose ranks nobody can edit, and no amount of
   * ownership brings it back.
   */
  manage?: string;

  /**
   * May this caller create, rename, re-grant or delete ranks in this scope?
   * Throw if not.
   *
   * The authorization gate for the module's own HTTP surface, and it is the
   * application's because only the application knows what managing one of
   * these means.
   */
  assertCanManage?: (scopeId: string, user: UserAccountToken) => Async<void>;

  /**
   * May this caller give somebody a rank in this scope? Throw if not.
   */
  assertCanAssign?: (scopeId: string, user: UserAccountToken) => Async<void>;

  /**
   * Write the assignment. The module does not own the column, so it cannot.
   */
  assign?: (scopeId: string, userId: string, rankKey: string) => Async<void>;

  /**
   * How many holders a rank has, so deleting one can be refused while
   * anybody still holds it.
   */
  countHolders?: (scopeId: string, rankKey: string) => Async<number>;

  /**
   * Load the row carrying the assignment, for the callers that have ids and
   * no rows.
   *
   * Used ONLY by the imperative {@link RankService.can} / `assert` path - a
   * `$secure` guard deciding per bucket, a closure handed to another module,
   * a resolver keyed on a slug. The middleware path never calls it, so the
   * zero-query contract is untouched where it matters.
   */
  load?: (
    scopeId: string,
    user: UserAccountToken,
  ) => Async<Record<string, unknown> | undefined>;

  /**
   * Say why a permission was refused, in this application's own words.
   *
   * Effective access is `application permission AND rank AND whatever else
   * the application layers on`, and only the application knows which conjunct
   * actually failed. Without this the module says "your rank does not grant
   * X", which sends a member to ask for a better rank when the true answer
   * may be that the whole feature is switched off for this scope - and the
   * owner then finds no such row in the matrix. Return `undefined` to accept
   * the module's own wording.
   *
   * ⚠️ Async, and it has to be: the conjunct that failed is usually a fact
   * about the scope that the application has to read (a capability switched
   * off, a subscription lapsed), and every caller of this is already in an
   * async frame.
   */
  refuse?: (refusal: RankRefusal) => Async<string | undefined>;
}

/**
 * The rows a decision is made from. Rows, never ids: an implementation that
 * was handed ids could go and query for the assignment, and the zero-query
 * contract would last exactly as long as nobody did.
 */
export interface RankRows {
  /**
   * The row the gate decided against - the scope itself, typically.
   */
  authority?: Record<string, unknown>;

  /**
   * The join row linking this caller to the scope, when there is one.
   */
  membership?: Record<string, unknown>;

  user: UserAccountToken;
}

/**
 * A rank that exists in code rather than as a row.
 */
export interface RankBuiltin {
  /**
   * The stable key an assignment stores.
   */
  key: string;

  /**
   * What a person reads, or a translation key the application resolves.
   */
  name: string;

  /**
   * What it grants. `["*"]` for a rank that holds everything the scope has -
   * the owner - which is the one place a wildcard is the honest answer,
   * because listing every permission would leave the owner behind every time
   * a new one is declared.
   */
  permissions: string[];

  /**
   * Whether an editor may rewrite this built-in's name and permission set.
   *
   * Off by default, which is what "built-in" means for the rank an
   * application never wants touched: the owner, whose `["*"]` is the whole
   * point of it, and any rank whose set the application will keep changing in
   * code later.
   *
   * On for the rank the application declares as a **starting point** rather
   * than as a rule - a default `member`, whose set is exactly the thing an
   * administrator will want to tune. Editing one writes a row that
   * {@link RankService.ranksOf} already prefers over the declaration, so the
   * edit is not silently reset from code on the next boot; the rank stays
   * non-removable either way, because that is the other half of being
   * built-in.
   */
  configurable?: boolean;
}

export interface RankRefusal {
  scopeId: string;
  /**
   * The rank the caller holds, or `undefined` when they hold none.
   */
  rank?: { key: string; name: string };
  /**
   * The permissions asked for that the rank does not grant.
   */
  missing: string[];
  user: UserAccountToken;
}

export class RankResourcePrimitive extends Primitive<RankResourcePrimitiveOptions> {
  protected readonly provider = $inject(RankResourceProvider);

  public get type(): string {
    return this.options.type;
  }

  protected onInit(): void {
    this.provider.register(this);
  }
}

/**
 * Teach the ranks module about one kind of scope.
 *
 * ```ts
 * class ProjectRanks {
 *   project = $rankResource({
 *     type: "project",
 *     scope: ({ authority }) =>
 *       typeof authority?.id === "number" ? String(authority.id) : undefined,
 *     rank: ({ membership }) => membership?.rank as string | undefined,
 *     builtins: [
 *       { key: "owner", name: "Owner", permissions: ["*"] },
 *       { key: "member", name: "Member", permissions: ["project:read"] },
 *     ],
 *     ownerOnly: ["project:delete", "capability:manage"],
 *     floor: ["project:read"],
 *     manage: "rank:manage",
 *   });
 * }
 * ```
 */
export const $rankResource = (
  options: RankResourcePrimitiveOptions,
): RankResourcePrimitive => createPrimitive(RankResourcePrimitive, options);

$rankResource[KIND] = RankResourcePrimitive;
