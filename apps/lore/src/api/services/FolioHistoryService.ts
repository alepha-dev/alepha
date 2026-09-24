import { $inject, Alepha, AlephaError } from "alepha";
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

/**
 * What `appendRevision` writes, and whether it was a NEW row.
 *
 * `created` is the coalesce window seen from the outside: a burst of
 * autosaves inside `COALESCE_WINDOW_MS` folds into one revision, so only
 * the first of them reports `true`. It exists because a caller cannot
 * infer it from the returned row - a folded row and a fresh one are the
 * same shape - and because `FolioController.update` passes it to the
 * client, whose History tab otherwise refetched the whole revision list
 * (up to ten FULL content snapshots) every 1.5 seconds of typing.
 */
export interface AppendedRevision {
  revision: FolioRevision;
  created: boolean;
}

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
      orderBy: [
        { column: "at", direction: "desc" },
        { column: "id", direction: "desc" },
      ],
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
   *
   * ## The head holds no copy of the body
   *
   * The row this writes is the newest, so its body would be byte-identical
   * to `folio.content`: it is written with `snapshotIsLive` and an empty
   * snapshot instead, and {@link FolioHistoryService.contentOf} answers the
   * live content for it (#Q2491). Before that, any OTHER live row is filled
   * in with `previousContent`, the body the folio held before this write,
   * which is exactly what that row documented. `previousContent` is
   * therefore required on every call but a folio's first: pass the body as
   * it was read BEFORE the write.
   */
  public async appendRevision(
    folio: Folio,
    byUserId: string,
    action: RevisionAction,
    previousContent: string | undefined,
  ): Promise<AppendedRevision> {
    // A revert always gets its own row, in BOTH directions. Blocking only
    // the "fold into a revert" side was a bug: the revert's own write would
    // fold into the edit revision that preceded it, overwriting the very
    // snapshot being reverted away from and leaving no trace that a revert
    // happened at all.
    const open =
      action === "revert"
        ? undefined
        : await this.findOpenRevision(folio.id, byUserId);

    await this.materializeLive(folio.id, previousContent, open?.id);

    if (open) {
      return {
        created: false,
        revision: await this.revisions.updateById(open.id, {
          at: this.dateTime.now().toISOString(),
          contentSnapshot: "",
          snapshotIsLive: true,
          titleSnapshot: folio.title,
          summarySnapshot: folio.summary,
        }),
      };
    }

    const inserted = await this.revisions.create({
      folioId: folio.id,
      at: this.dateTime.now().toISOString(),
      byUserId,
      action,
      contentSnapshot: "",
      snapshotIsLive: true,
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

    return { created: true, revision: inserted };
  }

  /**
   * Fill in every live revision of a folio but `keep` with the body the
   * folio held before the write in progress.
   *
   * Every live row documents the content the folio had until now, so this
   * is exact. It covers more than the head on purpose: a tie on `at` could
   * otherwise leave a second live row reading content written after it.
   *
   * ⚠️ A live row with no `previousContent` to fill it with is a caller
   * bug that would silently rewrite history, so it throws rather than
   * guessing.
   */
  protected async materializeLive(
    folioId: string,
    previousContent: string | undefined,
    keep: string | undefined,
  ): Promise<void> {
    const live = await this.revisions.findMany({
      where: { folioId: { eq: folioId }, snapshotIsLive: { eq: true } },
      columns: ["id"],
    });
    const stale = live.filter((row) => row.id !== keep);
    if (stale.length === 0) return;
    if (previousContent === undefined) {
      throw new AlephaError(
        "A live folio revision needs the previous content to be filled in",
      );
    }
    await this.revisions.updateMany(
      { id: { inArray: stale.map((row) => row.id) } },
      { contentSnapshot: previousContent, snapshotIsLive: false },
    );
  }

  /**
   * The body a revision documents: its snapshot, or the live folio's
   * content while it is the head. The one way to read a revision's body.
   */
  public contentOf(revision: FolioRevision, liveContent: string): string {
    return revision.snapshotIsLive ? liveContent : revision.contentSnapshot;
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
