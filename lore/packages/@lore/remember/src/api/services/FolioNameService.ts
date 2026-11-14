import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  $repository,
  DbConflictError,
  DbEntityNotFoundError,
} from "alepha/orm";
import { ConflictError } from "alepha/server";

import { folioNames } from "../entities/folioNames.ts";

/**
 * Sibling-name uniqueness enforcement for the Folio tree. Folios and
 * directories share the same namespace per parent: a folio named
 * "notes" and a directory named "notes" in the same folder collide.
 * Drive-style case-insensitive matching with the original casing
 * preserved on the entity row.
 *
 * Attachments (`folio_blobs`) are deliberately NOT in this namespace.
 * They belong to a single folio rather than sitting in a folder, so
 * they can only collide with each other — `FolioAttachmentService` handles
 * that within the owning folio, and a reservation row here would give
 * an attachment the power to block a folio name it never appears
 * beside.
 *
 * Reservations live in `folio_names`. The UNIQUE INDEX on
 * `(parent_directory_id, root_scope, lower_name)` is the actual
 * uniqueness guarantee. There is no transaction around the reservation
 * and its entity row (Lore runs on D1, which has none), so a create
 * CLAIMS the name first ({@link claim}), before its row exists: a racer
 * that loses the UNIQUE index retries with the next suffix, and nothing
 * is left half-written. This service offers the convenience layer:
 * claim, reserve, release, and "auto-suffix to first available name"
 * (Drive-style `logo (1).png`).
 */
export type FolioNodeKind = "folio" | "directory";

export interface ScopeKey {
  /**
   * Directory UUID, or `undefined` when reserving at the project root.
   */
  parentDirectoryId?: string;
  /**
   * Required when `parentDirectoryId` is undefined — `String(projectId)`.
   */
  rootScope?: string;
}

export class FolioNameService {
  protected readonly names = $repository(folioNames);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * The form a name is compared and stored in: trimmed and lowercased, so
   * `Runbook ` and `runbook` are the same sibling.
   */
  protected normalize(name: string): string {
    return name.trim().toLowerCase();
  }

  /**
   * Drive-style split: returns `stem` (without the trailing extension)
   * and `ext` (with the leading dot, or "" when none). A hidden file
   * like `.gitignore` is treated as "all stem, no extension" — matching
   * gdrive's behavior.
   */
  protected splitExt(name: string): { stem: string; ext: string } {
    const trimmed = name.trim();
    if (trimmed.startsWith(".")) return { stem: trimmed, ext: "" };
    const idx = trimmed.lastIndexOf(".");
    if (idx <= 0) return { stem: trimmed, ext: "" };
    return { stem: trimmed.slice(0, idx), ext: trimmed.slice(idx) };
  }

  /**
   * Build the `ScopeKey` for a node sitting under `parentDirectoryId`, or
   * at `projectId`'s root when there is no parent.
   *
   * Lives here rather than on either caller because both the folio and the
   * directory side have to agree on it exactly: a scope built one way at
   * create time and another at rename time reserves under two different
   * keys, and the reservation silently guards nothing.
   */
  public scopeOf(projectId: number, parentDirectoryId?: string): ScopeKey {
    return parentDirectoryId
      ? { parentDirectoryId }
      : { rootScope: String(projectId) };
  }

  /**
   * How many suffixes {@link claim} tries before giving up.
   */
  protected readonly claimAttempts = 5;

  /**
   * Claim the first free form of `desired` for `entityId`, and return it
   * (#Q2548).
   *
   * Called BEFORE the entity row is written, with an id the caller
   * generated: `folio_names.entityId` has no foreign key, so a reservation
   * may exist before its row. Two concurrent creates of "X" both see it
   * free; the loser's insert hits the UNIQUE index, and it re-suffixes and
   * tries again, so they end as "X" and "X (1)". Without a transaction the
   * UNIQUE violation is an ordinary error on every driver, which is what
   * makes this loop safe. Answers 409 after {@link claimAttempts} losses.
   *
   * If the row insert then fails, the caller releases the name.
   */
  public async claim(
    desired: string,
    kind: FolioNodeKind,
    entityId: string,
    scope: ScopeKey,
  ): Promise<string> {
    for (let attempt = 0; attempt < this.claimAttempts; attempt += 1) {
      const name = await this.autoSuffix(desired, scope);
      try {
        await this.reserve(name, kind, entityId, scope);
        return name;
      } catch (error) {
        if (!(error instanceof DbConflictError)) throw error;
      }
    }
    throw new ConflictError(
      `Could not claim the name "${desired}": it kept being taken by concurrent writes. Try again.`,
    );
  }

  /**
   * Reserve `name` for `entityId` of `kind` under `scope`. Throws if
   * another sibling already owns the name (case-insensitive). No
   * transaction ties it to the entity row: a create goes through
   * {@link claim} first, and releases the name if its row insert fails.
   *
   * SQLite gotcha: NULLs are distinct in UNIQUE indexes, so a row with a
   * NULL anywhere in the index can be inserted twice over. Both indexed
   * scope columns are therefore always non-null - `parent_directory_id`
   * takes a `root:<projectId>` sentinel at the project root, and
   * `root_scope` takes `""` inside a directory. `root_scope` used to be
   * left NULL there, which meant the index bit at the root and nowhere
   * else: every reservation inside a folder could be duplicated freely,
   * so the "one of the two racing writers loses" guarantee this
   * class documents held only for root-level names.
   */
  public async reserve(
    name: string,
    kind: FolioNodeKind,
    entityId: string,
    scope: ScopeKey,
  ): Promise<void> {
    await this.names.create({
      parentDirectoryId: this.dbParentId(scope),
      rootScope: scope.rootScope ?? "",
      lowerName: this.normalize(name),
      kind,
      entityId,
    });
  }

  /**
   * Compute the non-NULL key written to `folio_names.parent_directory_id`.
   * For root scopes, derives a sentinel from the rootScope so the UNIQUE
   * index actually catches collisions (SQLite treats multiple NULLs as
   * distinct).
   */
  protected dbParentId(scope: ScopeKey): string {
    if (scope.parentDirectoryId) return scope.parentDirectoryId;
    if (scope.rootScope === undefined) {
      throw new AlephaError("ScopeKey requires parentDirectoryId or rootScope");
    }
    return `root:${scope.rootScope}`;
  }

  /**
   * Drop the reservations of several entities in one statement. The caller
   * batches the list under D1's bound-parameter ceiling.
   */
  public async releaseByEntities(entityIds: readonly string[]): Promise<void> {
    if (entityIds.length === 0) return;
    await this.names.deleteMany({ entityId: { inArray: [...entityIds] } });
  }

  /**
   * Drop the reservation for `entityId`. Idempotent (no-op if missing).
   */
  public async releaseByEntity(entityId: string): Promise<void> {
    await this.names.deleteMany({ entityId: { eq: entityId } });
  }

  /**
   * Compute the first available name in the form `base`, `base (1)`,
   * `base (2)`, ... that doesn't collide with an existing reservation
   * under `scope`. Returns the unmodified `desired` when it's already
   * free.
   */
  public async autoSuffix(
    desired: string,
    scope: ScopeKey,
    exceptEntityId?: string,
  ): Promise<string> {
    const siblings = await this.namesAt(scope);
    const taken = new Set(
      siblings
        .filter((r) => r.entityId !== exceptEntityId)
        .map((r) => r.lowerName),
    );
    if (!taken.has(this.normalize(desired))) return desired;

    const { stem, ext } = this.splitExt(desired);
    for (let n = 1; n < 10_000; n++) {
      const candidate = ext ? `${stem} (${n})${ext}` : `${stem} (${n})`;
      if (!taken.has(this.normalize(candidate))) return candidate;
    }
    // Pathological: 10k collisions in one directory. Fall back to a
    // timestamp suffix so we always return something usable.
    const stamp = this.dateTime.nowMillis();
    return ext ? `${stem} (${stamp})${ext}` : `${stem} (${stamp})`;
  }

  /**
   * Convenience predicate — true if `name` is free under `scope`.
   * Useful for client-side pre-validation before the user submits.
   */
  public async isFree(name: string, scope: ScopeKey): Promise<boolean> {
    const siblings = await this.namesAt(scope);
    return !siblings.some((r) => r.lowerName === this.normalize(name));
  }

  protected async namesAt(scope: ScopeKey) {
    return this.names.findMany({
      where: { parentDirectoryId: { eq: this.dbParentId(scope) } },
      columns: ["lowerName", "entityId"],
    });
  }

  /**
   * Move `entityId`'s reservation to `desired` (suffixed if taken) under
   * `scope`, in ONE UPDATE of its own row, and return the name it holds
   * (#Q2549).
   *
   * Not release-then-reserve: with no transaction (D1), a reserve failing
   * after the release left the name unguarded. Here a UNIQUE conflict
   * refuses the UPDATE (409) and the old reservation stands. The entity's
   * own row is not counted as a sibling, so "Abc" to "abc" stays "abc"
   * rather than "abc (1)". An entity with no reservation row at all (one
   * written before reservations existed) gets one.
   */
  public async rename(
    entityId: string,
    kind: FolioNodeKind,
    desired: string,
    scope: ScopeKey,
  ): Promise<string> {
    const name = await this.autoSuffix(desired, scope, entityId);
    try {
      await this.names.updateOne(
        { entityId: { eq: entityId } },
        {
          parentDirectoryId: this.dbParentId(scope),
          rootScope: scope.rootScope ?? "",
          lowerName: this.normalize(name),
        },
      );
    } catch (error) {
      if (!(error instanceof DbEntityNotFoundError)) throw error;
      await this.reserve(name, kind, entityId, scope);
    }
    return name;
  }
}
