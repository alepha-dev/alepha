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
      });
    }

    for (const row of rows) {
      const declared = byKey.get(row.key);
      byKey.set(row.key, {
        key: row.key,
        name: row.name,
        permissions: row.permissions,
        builtin: row.builtin || declared?.builtin === true,
      });
    }

    return [...byKey.values()];
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

    const resource = this.resources.get(type);
    const load = resource.options.load;

    if (!load) {
      // Nothing to read the assignment off, and inventing a table to read it
      // from is the one thing this module must not do. Answering `true` keeps
      // the module additive: whatever gate already ran is the whole answer.
      return true;
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
      return false;
    }

    const permissions = await this.permissionsOf(type, scopeId, key);
    return permissions ? this.grants(permissions, permission) : false;
  }

  /**
   * {@link can}, as a refusal.
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
    throw new ForbiddenError(
      await this.refusal(this.resources.get(type), {
        scopeId,
        missing: [permission],
        user,
      }),
    );
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
    return `${held} does not grant ${refusal.missing.join(", ")}.`;
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

    if (declared) {
      // A declared built-in is refused rather than accepted and then reset
      // from code on the next boot. Silently discarding somebody's edit is
      // the failure this rule exists to prevent.
      throw new BadRequestError(
        `"${declared.name}" is a built-in rank and cannot be edited. Create a rank of your own instead.`,
      );
    }

    if (existing?.builtin) {
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
      builtin: false,
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

    if (!resource.options.assign) {
      throw new AlephaError(
        `The rank resource "${type}" declares no \`assign\`, so this module cannot write the assignment.`,
      );
    }

    await resource.options.assign(scopeId, userId, key);
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
export interface Rank {
  key: string;
  name: string;
  permissions: string[];
  /**
   * Non-removable, and refusing edits rather than accepting them and being
   * reset from code later.
   */
  builtin: boolean;
}

export interface ResolvedRank {
  type: string;
  scopeId: string;
  key?: string;
  name?: string;
  permissions: string[];
}

export type { RankBuiltin };
