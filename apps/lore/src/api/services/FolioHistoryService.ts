import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
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
 *
 * When both apply at once, content wins so the History tab labels the
 * dominant change.
 *
 * ⚠️ `tag-change` is still a member of this union and is deliberately never
 * returned: the tag feature is gone, but production rows already carry that
 * action and the column's schema has to keep decoding them.
 */
export type RevisionAction = FolioRevision["action"];

interface RevisionInput {
  /**
   * New title after the change.
   */
  title: string;
  /**
   * New content after the change (plaintext markdown or protected envelope).
   */
  content: string;
  summary: string;
}

/**
 * Writer + retention sweeper for `folio_revisions`. Used by
 * `FolioController.update` on every edit; called explicitly by the `revert`
 * endpoint.
 *
 * No longer append-ONLY: see {@link FolioHistoryService.appendRevision} for
 * why a save inside the coalescing window updates the newest revision in
 * place instead of inserting beside it.
 */
export class FolioHistoryService {
  protected readonly revisions = $repository(folioRevisions);
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How long a revision stays open to further edits by the same author.
   *
   * An hour is long enough that one writing session is one entry, and short
   * enough that coming back after lunch starts a new one. It exists because
   * the editor auto-saves: without coalescing, every pause in typing would
   * mint a revision and the retention cap would evict the whole session's
   * history within minutes.
   */
  protected readonly COALESCE_WINDOW_MS = 60 * 60 * 1000;

  /**
   * Which revision a change earns, or `undefined` when it earns none.
   *
   * A summary edit folds under `edit`: it is body text, and splitting it out
   * would put two entries in the timeline for one save.
   */
  public decideRevisionAction(
    prev: RevisionInput,
    next: RevisionInput,
  ): RevisionAction | undefined {
    const contentChanged =
      prev.content !== next.content || prev.summary !== next.summary;
    const titleChanged = prev.title !== next.title;
    if (contentChanged) return "edit";
    if (titleChanged) return "rename";
    return undefined;
  }

  /**
   * The newest revision, if it is still open to being folded into.
   *
   * `undefined` when there is none, when it belongs to someone else, when
   * it is pinned or a revert, or when it has aged out of the window — in
   * every one of those cases the caller must insert a new row.
   */
  protected async findOpenRevision(
    folioId: string,
    byUserId: string,
  ): Promise<FolioRevision | undefined> {
    const [head] = await this.revisions.findMany({
      where: { folioId: { eq: folioId } },
      orderBy: [{ column: "at", direction: "desc" }],
      limit: 1,
    });
    if (!head) return undefined;
    if (head.byUserId !== byUserId) return undefined;
    if (head.pinned) return undefined;
    if (head.action === "revert") return undefined;
    const age = this.dateTime.nowMillis() - Date.parse(head.at);
    return age < this.COALESCE_WINDOW_MS ? head : undefined;
  }

  /**
   * Record a revision and enforce the retention cap. Caller picks the
   * `action` (or computes it via {@link FolioHistoryService.decideRevisionAction}).
   *
   * ## Append, or fold into the one already open
   *
   * If the newest revision is the same author's, is less than an hour old,
   * and is not one of the two kinds that must stay untouched, this UPDATES
   * it in place instead of inserting: same row, new snapshot, refreshed
   * timestamp. One continuous writing session is therefore one history
   * entry whose snapshot is where the session got to.
   *
   * That is what makes auto-save affordable. A save per typing pause would
   * otherwise insert a revision per pause, and the retention cap (10
   * non-pinned by default) would evict the entire session — and everything
   * before it — inside a few minutes of writing. Coalescing keeps history
   * measured in sessions rather than in keystrokes.
   *
   * Two kinds are never folded into:
   * - **pinned**, because pinning means "keep exactly this snapshot", and
   *   overwriting it would silently discard the thing the user asked to
   *   keep;
   * - **revert**, because a revert is a deliberate checkpoint — folding an
   *   edit into it would erase the evidence that a revert happened.
   *
   * The folded row keeps the action it was CREATED with, so a burst that
   * began as `create` still reads as `create` however much was typed into
   * it afterwards. The alternative — relabelling to the latest action —
   * would report a brand-new folio as an `edit`.
   */
  public async appendRevision(
    folio: Folio,
    byUserId: string,
    action: RevisionAction,
  ): Promise<FolioRevision> {
    // A revert always gets its own row, in BOTH directions. Blocking only
    // the "fold into a revert" side was a bug: the revert's own write would
    // fold into the edit revision that preceded it, overwriting the very
    // snapshot being reverted away from and leaving no trace that a revert
    // happened at all.
    const open =
      action === "revert"
        ? undefined
        : await this.findOpenRevision(folio.id, byUserId);
    if (open) {
      return await this.revisions.updateById(open.id, {
        at: this.dateTime.now().toISOString(),
        contentSnapshot: folio.content,
        titleSnapshot: folio.title,
        summarySnapshot: folio.summary,
      });
    }

    const inserted = await this.revisions.create({
      folioId: folio.id,
      at: this.dateTime.now().toISOString(),
      byUserId,
      action,
      contentSnapshot: folio.content,
      titleSnapshot: folio.title,
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

  /**
   * Drop every revision of a folio. Called when the folio crosses a
   * protection boundary (clear ⇄ protected) — the stored snapshots belong
   * to the old cryptographic domain and must not outlive it.
   *
   * Going clear → protected this is a **confidentiality** requirement: the
   * plaintext snapshots are readable by any project member via
   * `GET /folios/:id/history`, so encrypting a folio without this purge
   * protects nothing that was already written.
   *
   * Going protected → clear it keeps the invariant symmetric: leftover
   * ciphertext snapshots are undecryptable noise in the History tab, and
   * reverting to one would write an envelope into a folio the client
   * renders as markdown.
   *
   * `pinned` is deliberately NOT honored here — it exempts a revision from
   * the retention sweep, not from the protection-domain purge.
   */
  public async purgeRevisions(folioId: string): Promise<void> {
    await this.revisions.deleteMany({ folioId: { eq: folioId } });
  }

  public async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.revisions.updateById(id, { pinned });
  }
}
