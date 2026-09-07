import { $inject, Alepha, AlephaError } from "alepha";
import { $repository } from "alepha/orm";
import {
  ResourceGateMemoProvider,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { BadRequestError, ForbiddenError, NotFoundError } from "alepha/server";

import { currentRankAtom } from "../atoms/currentRankAtom.ts";
import { rankDefinitions } from "../entities/rankDefinitions.ts";
import type {
  RankBuiltin,
  RankResourcePrimitive,
  RankRows,
} from "../primitives/$rankResource.ts";
import { RankResourceProvider } from "../providers/RankResourceProvider.ts";

/**
 * Resolving a rank, and every rule about writing one.
 *
 * ## The two caches, and why they are not one
 *
 * **Definitions are cached** for {@link DEFINITIONS_CACHE_TTL_MS}, and the
 * window is stated rather than hidden: what a rank MEANS changes when
 * somebody edits it, is shared by every holder, and a stale answer for thirty
 * seconds is a rank that grants what it granted half a minute ago.
 *
 * **An assignment is never cached.** The assignment IS the grant, so caching
 * it caches an authorization decision and revocation stops taking effect on
 * the next request. That is why it is read off a row the request already
 * loaded and never through a window: removing somebody takes effect on their
 * next request, not at the end of a window somebody chose.
 *
 * A blanket cache over both - which is what a naive "staff map" cache is -
 * gets the second one wrong, and it is the one that gates a till.
 */
export class RankService {
  /**
   * How long a scope's definitions are held. Deliberately the same order as
   * the resource-gate window an application already accepts for its scope
   * row, so a rank does not become the slowest thing on the request.
   */
  public static readonly DEFINITIONS_CACHE_TTL_MS = 30_000;

  protected readonly alepha = $inject(Alepha);
  protected readonly resources = $inject(RankResourceProvider);
  protected readonly security = $inject(SecurityProvider);
  protected readonly memo = $inject(ResourceGateMemoProvider);
  protected readonly definitions = $repository(rankDefinitions);

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * Every rank that exists in a scope: the declared built-ins, plus the
   * stored rows, with a stored row of the same key winning.
   *
   * A built-in whose key a stored row reuses is a built-in the application
   * has customised. It stays non-removable - that is what makes it built-in -
   * but its name and its permissions are whatever the row says.
   */
  public async ranksOf(type: string, scopeId: string): Promise<Rank[]> {
    const resource = this.resources.get(type);
    const rows = await this.definitionsOf(type, scopeId);

    const byKey = new Map<string, Rank>();

    for (const builtin of resource.options.builtins) {
      byKey.set(builtin.key, {
        key: builtin.key,
        name: builtin.name,
        permissions: builtin.permissions,
        builtin: true,
        editable: builtin.configurable === true,
      });
    }

    for (const row of rows) {
      const declared = byKey.get(row.key);
      byKey.set(row.key, {
        key: row.key,
        name: row.name,
        permissions: row.permissions,
        builtin: row.builtin || declared?.builtin === true,
        // A row over a declaration keeps the declaration's answer: the row
        // exists BECAUSE the built-in was configurable, and a row that is
        // `builtin` for another reason (the application marked it permanent)
        // is not editable at all.
        editable: declared ? declared.editable : !row.builtin,
      });
    }

    return [...byKey.values()];
  }

  /**
   * {@link ranksOf} for a LIST of scopes, in one read.
   *
   * For the surfaces that show several scopes at once - a project list, an
   * account page - where naming each row's rank one scope at a time is N
   * reads for a list already in memory. The 30 second definitions cache
   * makes the second such call free and the first one expensive; this makes
   * the first one one query.
   *
   * ⚠️ An empty `scopeIds` short-circuits, because `inArray: []` throws
   * rather than matching nothing - and a caller with no scopes at all is
   * exactly the request that reaches it.
   */
  public async ranksOfMany(
    type: string,
    scopeIds: readonly string[],
  ): Promise<Map<string, Rank[]>> {
    const resource = this.resources.get(type);
    const byScope = new Map<string, Rank[]>();

    const declared = (): Rank[] =>
      resource.options.builtins.map((builtin) => ({
        key: builtin.key,
        name: builtin.name,
        permissions: builtin.permissions,
        builtin: true,
        editable: builtin.configurable === true,
      }));

    for (const scopeId of scopeIds) {
      byScope.set(scopeId, declared());
    }

    if (scopeIds.length === 0) {
      return byScope;
    }

    const rows = await this.definitions.findMany(
      {
        where: {
          type: { eq: type },
          scopeId: { inArray: [...scopeIds] },
        },
      },
      { cache: { ttl: RankService.DEFINITIONS_CACHE_TTL_MS } },
    );

    for (const row of rows) {
      const list = byScope.get(row.scopeId);
      if (!list) continue;
      const at = list.findIndex((it) => it.key === row.key);
      const rank: Rank = {
        key: row.key,
        name: row.name,
        permissions: row.permissions,
        builtin: row.builtin || (at >= 0 && list[at].builtin),
        editable: at >= 0 ? list[at].editable : !row.builtin,
      };
      if (at >= 0) {
        list[at] = rank;
      } else {
        list.push(rank);
      }
    }

    return byScope;
  }

  /**
   * The effective permission set of one rank key inside one scope.
   *
   * `undefined` when the key names no rank at all, which a caller must not
   * confuse with an empty set: the first is an assignment pointing at
   * something deleted, the second is a rank that grants nothing.
   */
  public async permissionsOf(
    type: string,
    scopeId: string,
    key: string,
  ): Promise<string[] | undefined> {
    const rank = (await this.ranksOf(type, scopeId)).find(
      (it) => it.key === key,
    );
    if (!rank) {
      return undefined;
    }
    return this.withFloor(this.resources.get(type), rank.permissions);
  }

  /**
   * Resolve the caller's rank from rows the request already holds, and
   * publish it.
   *
   * Zero queries for the assignment, by construction: `rank()` is
   * synchronous and reads a column. The one read here is the definitions,
   * cached, and skipped entirely for a scope whose ranks nobody has touched.
   */
  public async resolve(rows: RankRows): Promise<ResolvedRank | undefined> {
    const found = this.resources.resolve(rows);
    if (!found) {
      return undefined;
    }

    const { resource, scopeId } = found;
    const key = resource.options.rank(rows);

    const resolved: ResolvedRank = {
      type: resource.type,
      scopeId,
      permissions: [],
    };

    if (key) {
      const rank = (await this.ranksOf(resource.type, scopeId)).find(
        (it) => it.key === key,
      );
      if (rank) {
        resolved.key = rank.key;
        resolved.name = rank.name;
        resolved.permissions = this.withFloor(resource, rank.permissions);
      }
    }

    this.alepha.store.set(currentRankAtom, resolved);
    return resolved;
  }

  /**
   * Does this permission set carry `permission`?
   *
   * `*` grants everything, and a trailing `*` grants a prefix - the same
   * reading a wildcard has everywhere else in this framework.
   */
  public grants(permissions: readonly string[], permission: string): boolean {
    return permissions.some(
      (granted) =>
        granted === "*" ||
        granted === permission ||
        (granted.endsWith("*") && permission.startsWith(granted.slice(0, -1))),
    );
  }

  // -------------------------------------------------------------------------
  // The imperative check
  // -------------------------------------------------------------------------

  /**
   * "May this caller do X in this scope", for the call sites a middleware
   * cannot reach.
   *
   * A `$secure` guard deciding which scope to ask about several branches in,
   * a closure handed to another module, a resolver keyed on a slug: none of
   * them has a `use:` array to put a gate in, and all of them still have to
   * answer the same question the gate answers.
   *
   * Reads {@link currentRankAtom} when the gate already ran, so a request
   * that gates and then asks imperatively resolves once. Otherwise it asks
   * the resource to load the row, through the request memo, so two imperative
   * questions in one request also resolve once.
   */
  public async can(
    type: string,
    scopeId: string,
    permission: string,
    user: UserAccountToken,
  ): Promise<boolean> {
    // A privileged identity is not narrowed by a rank, matching `$owns`.
    if (user.ownership === false) {
      return true;
    }

    const current = this.alepha.store.get(currentRankAtom);
    if (current && current.type === type && current.scopeId === scopeId) {
      return this.grants(current.permissions, permission);
    }

    const rank = await this.rankOf(type, scopeId, user);

    // `undefined` two ways, and they answer the same: no `load` closure to
    // read the assignment off (the module stays additive - whatever gate
    // already ran is the whole answer, so `true`), or no assignment at all
    // (`false`). The first is a resource that opted out; the second is
    // somebody who is not in the scope.
    if (rank === UNGOVERNED) {
      return true;
    }

    return rank
      ? this.grants(
          this.withFloor(this.resources.get(type), rank.permissions),
          permission,
        )
      : false;
  }

  /**
   * {@link can}, as a refusal.
   *
   * ⚠️ Resolves the rank a second time so the message can NAME it. Free in
   * practice - the membership row is in the request memo and the definitions
   * in the ORM's cache - and the alternative is a refusal that says "your
   * rank" to somebody who does not know which rank they hold.
   */
  public async assert(
    type: string,
    scopeId: string,
    permission: string,
    user: UserAccountToken,
  ): Promise<void> {
    if (await this.can(type, scopeId, permission, user)) {
      return;
    }
    const rank = await this.rankOf(type, scopeId, user);
    throw new ForbiddenError(
      await this.refusal(this.resources.get(type), {
        scopeId,
        ...(rank && rank !== UNGOVERNED
          ? { rank: { key: rank.key, name: rank.name } }
          : {}),
        missing: [permission],
        user,
      }),
    );
  }

  /**
   * The rank this user holds in this scope, on the imperative path.
   *
   * {@link UNGOVERNED} when the resource declares no `load`, which is not the
   * same as holding no rank: it means this resource cannot answer the
   * question at all, and the caller should not narrow anything.
   */
  protected async rankOf(
    type: string,
    scopeId: string,
    user: UserAccountToken,
  ): Promise<Rank | typeof UNGOVERNED | undefined> {
    const resource = this.resources.get(type);
    const load = resource.options.load;

    if (!load) {
      return UNGOVERNED;
    }

    const membership = await this.memo.resolve(
      `rank:${type}:${scopeId}:${user.id}`,
      async () => (await load(scopeId, user)) ?? null,
    );

    const key = resource.options.rank({
      user,
      membership: membership ?? undefined,
    });

    if (!key) {
      return undefined;
    }

    return (await this.ranksOf(type, scopeId)).find((it) => it.key === key);
  }

  /**
   * The refusal message, the application's if it wrote one.
   *
   * Effective access is a conjunction, and only the application knows which
   * conjunct failed. The module's own wording sends a member to ask for a
   * better rank, which is a closed loop when the true answer is that the
   * feature is switched off for this scope and the matrix therefore has no
   * row to grant.
   */
  public async refusal(
    resource: RankResourcePrimitive,
    refusal: {
      scopeId: string;
      rank?: { key: string; name: string };
      missing: string[];
      user: UserAccountToken;
    },
  ): Promise<string> {
    const written = await resource.options.refuse?.(refusal);
    if (written) {
      return written;
    }
    const held = refusal.rank
      ? `Your rank (${refusal.rank.name})`
      : "Your rank";

    // ⚠️ Names the FIX as well as the cause. A refusal that says only what is
    // missing leaves the reader - very often an agent - with nowhere to go,
    // and the answer here is never "try again": somebody else has to change
    // the rank. `manage` is the permission that person holds, and the
    // resource declares it, so this points at a real thing rather than at an
    // administrator in the abstract.
    const fix = resource.options.manage
      ? ` Ask somebody who holds ${resource.options.manage}.`
      : "";

    return `${held} does not grant ${refusal.missing.join(", ")}.${fix}`;
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  /**
   * Create or replace a rank's definition inside a scope.
   *
   * Every invariant lives here rather than in the editor, because an editor
   * is one client and this is the write path.
   */
  public async save(
    type: string,
    scopeId: string,
    input: { key: string; name: string; permissions: string[] },
    writer: UserAccountToken,
  ): Promise<Rank> {
    const resource = this.resources.get(type);

    await resource.options.assertCanManage?.(scopeId, writer);
    await this.assertGrantable(resource, scopeId, input.permissions, writer);

    const declared = resource.options.builtins.find(
      (it) => it.key === input.key,
    );
    const existing = await this.definitionOf(type, scopeId, input.key);

    if (declared && !declared.configurable) {
      // A declared built-in is refused rather than accepted and then reset
      // from code on the next boot. Silently discarding somebody's edit is
      // the failure this rule exists to prevent.
      //
      // ⚠️ `configurable` is the exception, and it is not a loophole: the row
      // this write creates is one {@link ranksOf} already prefers over the
      // declaration, so the edit is read back rather than reset. That is what
      // lets an application declare a DEFAULT `member` - a starting point an
      // administrator is expected to tune - without also declaring a rank
      // that must never move.
      throw new BadRequestError(
        `"${declared.name}" is a built-in rank and cannot be edited. Create a rank of your own instead.`,
      );
    }

    if (existing?.builtin && !declared?.configurable) {
      throw new BadRequestError(`"${existing.name}" cannot be edited.`);
    }

    await this.assertNoSelfLockout(resource, scopeId, input, writer);

    if (existing) {
      await this.definitions.updateById(existing.id, {
        name: input.name,
        permissions: input.permissions,
      });
    } else {
      await this.definitions.create({
        type,
        scopeId,
        key: input.key,
        name: input.name,
        permissions: input.permissions,
      });
    }

    return {
      key: input.key,
      name: input.name,
      permissions: input.permissions,
      builtin: declared !== undefined,
      editable: true,
    };
  }

  /**
   * Delete a custom rank.
   *
   * ⚠️ **Refused while anybody holds it.** Reassign first. Falling back to
   * some other rank would be a demotion (or a promotion) nobody asked for,
   * applied to people who are not in the room.
   */
  public async remove(
    type: string,
    scopeId: string,
    key: string,
    writer: UserAccountToken,
  ): Promise<void> {
    const resource = this.resources.get(type);
    await resource.options.assertCanManage?.(scopeId, writer);

    if (resource.options.builtins.some((it) => it.key === key)) {
      throw new BadRequestError("A built-in rank cannot be deleted.");
    }

    const existing = await this.definitionOf(type, scopeId, key);
    if (!existing) {
      throw new NotFoundError(`No rank "${key}" in this scope`);
    }
    if (existing.builtin) {
      throw new BadRequestError(`"${existing.name}" cannot be deleted.`);
    }

    const holders = (await resource.options.countHolders?.(scopeId, key)) ?? 0;
    if (holders > 0) {
      throw new BadRequestError(
        `${holders} member(s) still hold "${existing.name}". Move them to another rank first.`,
      );
    }

    await this.definitions.deleteById(existing.id);
  }

  /**
   * Give somebody a rank.
   *
   * The module does not own the column the assignment lives in, so it cannot
   * write it: {@link RankResourcePrimitiveOptions.assign} does, and this
   * checks first.
   */
  public async assign(
    type: string,
    scopeId: string,
    userId: string,
    key: string,
    writer: UserAccountToken,
  ): Promise<void> {
    const resource = this.resources.get(type);

    // ⚠️ Never your own row, and this is the module's rule rather than the
    // application's because every consumer has it. The subset rule below stops
    // you handing somebody MORE than you hold; it cannot stop you handing
    // yourself less, and a scope whose only manager has just demoted
    // themselves out of `manage` is locked with no way back - the same
    // self-lockout `save` refuses, through the other door. Changing your own
    // rank is somebody else's act.
    if (userId === writer.id) {
      throw new BadRequestError(
        "You cannot change your own rank. Ask somebody who can.",
      );
    }

    await this.assertAssignable(type, scopeId, key, writer);

    if (!resource.options.assign) {
      throw new AlephaError(
        `The rank resource "${type}" declares no \`assign\`, so this module cannot write the assignment.`,
      );
    }

    await resource.options.assign(scopeId, userId, key);
  }

  /**
   * May this writer hand somebody this rank?
   *
   * Split out of {@link assign} because an assignment has a second door: an
   * INVITATION that names the rank its invitee lands on is the same act
   * separated by however long the invitation is left unanswered, and it has
   * to pass the same rules at the moment it is written - checking only at
   * accept would be checking against whoever happens to be around then.
   *
   * Deliberately not the whole of `assign`: it says nothing about WHO is
   * being assigned, because an invitation has no user id yet.
   */
  public async assertAssignable(
    type: string,
    scopeId: string,
    key: string,
    writer: UserAccountToken,
  ): Promise<Rank> {
    const resource = this.resources.get(type);

    await resource.options.assertCanAssign?.(scopeId, writer);

    const rank = (await this.ranksOf(type, scopeId)).find(
      (it) => it.key === key,
    );
    if (!rank) {
      throw new NotFoundError(`No rank "${key}" in this scope`);
    }

    // ⚠️ The SUBSET rule only, not the whole write-path check.
    //
    // Handing somebody a rank you could not have written is the same
    // escalation by a different door, so the subset rule applies. The rest of
    // `assertGrantable` does not: a built-in that grants `*` is a rank that
    // already exists, and refusing to assign it as "you cannot grant `*`"
    // answers a question nobody asked - the application's own closure has a
    // truer refusal for that case, and it never gets to speak if this throws
    // first.
    await this.assertWithinWriterSet(
      resource,
      scopeId,
      rank.permissions,
      writer,
    );

    return rank;
  }

  // -------------------------------------------------------------------------
  // Invariants
  // -------------------------------------------------------------------------

  /**
   * The four rules a set of permissions has to pass before it can be written
   * onto a rank.
   */
  protected async assertGrantable(
    resource: RankResourcePrimitive,
    scopeId: string,
    permissions: string[],
    writer: UserAccountToken,
  ): Promise<void> {
    const registered = new Set(
      this.security
        .getPermissions()
        .map((it) => (it.group ? `${it.group}:${it.name}` : it.name)),
    );

    for (const permission of permissions) {
      // 1. Never an administrative permission. A rank is held inside one
      // scope and `admin:*` is not scoped to anything, so granting one from a
      // scope editor is a way out of the scope.
      //
      // Checked BEFORE the registry, on purpose: an application that declares
      // its admin permissions - most do - would otherwise get "not a
      // permission this application declares" for a string that very much is
      // one, and the refusal would point at the wrong problem.
      if (permission === "*" || permission.startsWith("admin:")) {
        throw new BadRequestError(
          `"${permission}" cannot be granted by a rank.`,
        );
      }

      // 2. Only a permission the application declared. This is what makes
      // "never widen" checkable rather than aspirational, and it is checked
      // against the one registry `$secure` and `$permission` both fill -
      // never against a list this module keeps of its own.
      if (!registered.has(permission)) {
        throw new BadRequestError(
          `"${permission}" is not a permission this application declares.`,
        );
      }

      // 3. The ceiling: acts that belong to the scope's owner structurally.
      if (resource.options.ownerOnly?.includes(permission)) {
        throw new BadRequestError(
          `"${permission}" belongs to the owner and cannot be granted to a rank.`,
        );
      }
    }

    // 4. The floor: a rank that cannot open the scope is a removal expressed
    // badly, and removal already says it properly.
    for (const floor of resource.options.floor ?? []) {
      if (!permissions.includes(floor)) {
        throw new BadRequestError(
          `Every rank holds "${floor}"; it cannot be withheld.`,
        );
      }
    }

    // 5. No self-escalation.
    await this.assertWithinWriterSet(resource, scopeId, permissions, writer);
  }

  /**
   * The subset rule: a writer may only hand out what they already hold in this
   * scope.
   *
   * Re-checked on every write rather than trusted from whatever the editor
   * rendered, and separate from the rest of {@link assertGrantable} because
   * assignment needs this rule and none of the others.
   */
  protected async assertWithinWriterSet(
    resource: RankResourcePrimitive,
    scopeId: string,
    permissions: string[],
    writer: UserAccountToken,
  ): Promise<void> {
    if (writer.ownership === false) {
      return;
    }

    const held = await this.heldBy(resource, scopeId, writer);
    const beyond = permissions.filter((it) => !this.grants(held, it));

    if (beyond.length) {
      throw new BadRequestError(
        `You cannot grant a permission you do not hold: ${beyond.join(", ")}.`,
      );
    }
  }

  /**
   * A writer may not remove, from the rank they themselves hold, the
   * permission that let them write.
   *
   * The scope would then have ranks nobody can edit, and no amount of
   * ownership brings that back without a database.
   */
  protected async assertNoSelfLockout(
    resource: RankResourcePrimitive,
    scopeId: string,
    input: { key: string; permissions: string[] },
    writer: UserAccountToken,
  ): Promise<void> {
    const manage = resource.options.manage;
    if (!manage || writer.ownership === false) {
      return;
    }

    const current = this.alepha.store.get(currentRankAtom);
    const ownKey =
      current && current.scopeId === scopeId ? current.key : undefined;

    if (ownKey === input.key && !this.grants(input.permissions, manage)) {
      throw new BadRequestError(
        `Removing "${manage}" from your own rank would leave nobody able to edit ranks here.`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * What the writer holds in this scope.
   *
   * The atom when the gate published one, the resource's own `load` when it
   * did not. An owner-built-in holding `["*"]` passes everything, which is
   * what makes the subset rule harmless for the person who owns the scope.
   */
  protected async heldBy(
    resource: RankResourcePrimitive,
    scopeId: string,
    writer: UserAccountToken,
  ): Promise<string[]> {
    const current = this.alepha.store.get(currentRankAtom);
    if (
      current &&
      current.type === resource.type &&
      current.scopeId === scopeId
    ) {
      return current.permissions;
    }

    const load = resource.options.load;
    if (!load) {
      return [];
    }

    const membership = await this.memo.resolve(
      `rank:${resource.type}:${scopeId}:${writer.id}`,
      async () => (await load(scopeId, writer)) ?? null,
    );

    const key = resource.options.rank({
      user: writer,
      membership: membership ?? undefined,
    });

    if (!key) {
      return [];
    }

    return (await this.permissionsOf(resource.type, scopeId, key)) ?? [];
  }

  /**
   * The stored definitions of a scope, cached.
   */
  protected async definitionsOf(type: string, scopeId: string) {
    return await this.definitions.findMany(
      {
        where: { type: { eq: type }, scopeId: { eq: scopeId } },
      },
      { cache: { ttl: RankService.DEFINITIONS_CACHE_TTL_MS } },
    );
  }

  protected async definitionOf(type: string, scopeId: string, key: string) {
    return await this.definitions.findOne({
      where: { type: { eq: type }, scopeId: { eq: scopeId }, key: { eq: key } },
    });
  }

  /**
   * The floor, folded in. Applied on read as well as refused on write, so a
   * row written before a floor permission existed still answers correctly.
   */
  protected withFloor(
    resource: RankResourcePrimitive,
    permissions: string[],
  ): string[] {
    const floor = resource.options.floor ?? [];
    const merged = new Set(permissions);
    for (const it of floor) {
      merged.add(it);
    }
    return [...merged];
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A rank as it exists in a scope, whether it came from code or from a row.
 */
/**
 * "This resource cannot answer", as distinct from "you hold no rank".
 *
 * A symbol rather than a boolean flag beside the value: the two readings lead
 * to opposite answers - allow everything, or allow nothing - and a caller that
 * confused them would either open a scope up or lock it shut.
 */
const UNGOVERNED = Symbol("alepha.api.ranks.ungoverned");

export interface Rank {
  key: string;
  name: string;
  permissions: string[];
  /**
   * Non-removable, and refusing edits rather than accepting them and being
   * reset from code later.
   */
  builtin: boolean;
  /**
   * Whether {@link RankService.save} will accept a rewrite of this rank.
   *
   * ⚠️ Not the negation of {@link builtin}. A built-in declared
   * {@link RankBuiltin.configurable} is both - non-removable AND editable -
   * which is the shape of a default `member` that an administrator is
   * expected to tune. An editor that derived this from `builtin` would offer
   * no way to edit that rank, and there would be nothing on screen to say
   * why.
   */
  editable: boolean;
}

export interface ResolvedRank {
  type: string;
  scopeId: string;
  key?: string;
  name?: string;
  permissions: string[];
}

export type { RankBuiltin };
