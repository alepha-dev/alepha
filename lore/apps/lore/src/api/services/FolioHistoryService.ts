import { $inject, Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { folioHistoryAtom } from "../atoms/folioHistoryAtom.ts";
import {
  type FolioRevision,
  folioRevisions,
} from "../entities/folioRevisions.ts";
import type { Folio } from "../entities/folios.ts";

/**
 * Action label written on each revision. Computed from the diff between
 * the previous folio state and the new payload:
 * - `content` changed → `edit` (covers summary-only edits too — same
 *   class of "content text changed" for the user's purposes)
 * - `title` changed → `rename`
 * - `tags` changed (and content/title didn't) → `tag-change`
 *
 * When multiple categories apply at once, priority is content >
 * rename > tag-change so the History tab labels the dominant change.
 */
export type RevisionAction = FolioRevision["action"];

interface RevisionInput {
  /** New title after the change. */
  title: string;
  /** New content after the change (plaintext markdown or protected envelope). */
  content: string;
  tags: string[];
  summary: string;
}

const tagsEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const sorted = [...a].sort();
  const other = [...b].sort();
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== other[i]) return false;
  }
  return true;
};

export const decideRevisionAction = (
  prev: RevisionInput,
  next: RevisionInput,
): RevisionAction | undefined => {
  const contentChanged =
    prev.content !== next.content || prev.summary !== next.summary;
  const titleChanged = prev.title !== next.title;
  const tagsChanged = !tagsEqual(prev.tags, next.tags);
  if (contentChanged) return "edit";
  if (titleChanged) return "rename";
  if (tagsChanged) return "tag-change";
  return undefined;
};

/**
 * Append-only writer + retention sweeper for `folio_revisions`. Used by
 * `FolioController.update` on every edit; called explicitly by the
 * `revert` endpoint.
 */
export class FolioHistoryService {
  protected readonly revisions = $repository(folioRevisions);
  protected readonly alepha = $inject(Alepha);

  /**
   * Append a revision and enforce the retention cap. Caller picks the
   * `action` (or computes it via {@link decideRevisionAction}).
   * Returns the inserted revision row.
   */
  public async appendRevision(
    folio: Folio,
    byUserId: string,
    action: RevisionAction,
  ): Promise<FolioRevision> {
    const inserted = await this.revisions.create({
      folioId: folio.id,
      at: new Date().toISOString(),
      byUserId,
      action,
      contentSnapshot: folio.content,
      titleSnapshot: folio.title,
      tagsSnapshot: folio.tags,
      summarySnapshot: folio.summary,
      pinned: false,
    });

    // Retention sweep — keep at most `cap` non-pinned revisions per
    // folio. Pinned revisions are exempt and don't count against the
    // cap (a user can pin all 10, then every new revision is dropped on
    // the next sweep — acceptable, the user chose to freeze the history
    // by pinning).
    const cap = this.alepha.store.get(folioHistoryAtom).maxRevisions;
    const nonPinned = await this.revisions.findMany({
      where: { folioId: { eq: folio.id }, pinned: { eq: false } },
      orderBy: [{ column: "at", direction: "desc" }],
    });
    if (nonPinned.length > cap) {
      const toDrop = nonPinned.slice(cap);
      for (const rev of toDrop) {
        await this.revisions.deleteById(rev.id);
      }
    }

    return inserted;
  }

  /**
   * Return revisions for a folio, newest first. Capped by the
   * retention atom (no separate pagination — there's at most N entries
   * by construction).
   */
  public async listRevisions(folioId: string): Promise<FolioRevision[]> {
    return this.revisions.findMany({
      where: { folioId: { eq: folioId } },
      orderBy: [{ column: "at", direction: "desc" }],
    });
  }

  public async findRevision(id: string): Promise<FolioRevision | undefined> {
    return this.revisions.findOne({ where: { id: { eq: id } } });
  }

  public async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.revisions.updateById(id, { pinned });
  }
}
