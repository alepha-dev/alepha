import { $inject, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";

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
 * Reservations live in `folio_names`. Each create/rename/move
 * writes the entity row AND a reservation row in one transaction
 * (`$transactional()` on the controller action). The UNIQUE INDEX on
 * `(parent_directory_id, root_scope, lower_name)` is the actual
 * uniqueness guarantee — if two writers race, one of them gets a UNIQUE
 * constraint violation and rolls back. This service offers the
 * convenience layer: reserve, release, and "auto-suffix to first
 * available name" (Drive-style `logo (1).png`).
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
   * Reserve `name` for `entityId` of `kind` under `scope`. Throws if
   * another sibling already owns the name (case-insensitive). Caller
   * should run this inside the same transaction that inserts the
   * entity row so the reservation rolls back together with the entity
   * on failure.
   *
   * SQLite gotcha: NULLs are distinct in UNIQUE indexes, so a row with a
   * NULL anywhere in the index can be inserted twice over. Both indexed
   * scope columns are therefore always non-null - `parent_directory_id`
   * takes a `root:<projectId>` sentinel at the project root, and
   * `root_scope` takes `""` inside a directory. `root_scope` used to be
   * left NULL there, which meant the index bit at the root and nowhere
   * else: every reservation inside a folder could be duplicated freely,
   * so the "one of the two racing writers rolls back" guarantee this
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
  public async autoSuffix(desired: string, scope: ScopeKey): Promise<string> {
    const siblings = await this.namesAt(scope);
    const taken = new Set(siblings.map((r) => r.lowerName));
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
      columns: ["lowerName"],
    });
  }
}
