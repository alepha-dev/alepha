import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { AlephaError } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import {
  useAction,
  useAlepha,
  useClient,
  useInject,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ZipArchive } from "alepha/system";
import { useEffect, useState } from "react";

import type { FolioController } from "@/api/controllers/FolioController.ts";
import type { Folio } from "@/api/entities/folios.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentFolioAtom } from "../../../atoms/currentFolioAtom.ts";
import { currentFolioBlobsAtom } from "../../../atoms/currentFolioBlobsAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { userFoliosAtom } from "../../../atoms/userFoliosAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import {
  ensureProtectedKeysAutoLock,
  forgetProtectedKey,
  getProtectedKey,
  rememberProtectedKey,
} from "../protectedFolioKeys.ts";
import {
  folioExportFilename,
  folioMarkdownExport,
  triggerFolioDownload,
} from "./document/folioMarkdownExport.ts";
import { folioZipEntries } from "./document/folioZipExport.ts";
import type {
  FolioActionId,
  FolioActionState,
} from "./menubar/folioMenubarModel.ts";
import {
  type FolioDraft,
  type FolioDraftValues,
  sameValues,
} from "./useFolioDraft.ts";

export type FolioActionHandlers = Record<
  FolioActionId,
  () => void | Promise<void>
>;

export interface UseFolioActionsInput {
  folio?: Folio;
  /**
   * Create-mode only: the directory the new folio lands in.
   */
  directoryId?: string;
  draft: FolioDraft;
  panes: {
    tree: boolean;
    inspector: boolean;
    toggleTree: () => void;
    toggleInspector: () => void;
    toggleFocus: () => void;
    /**
     * Opens the inspector pane (if closed) and switches it to the History
     * tab — backs `history.revisions` (⌘Y). The other three `history.*`
     * ids (`compare`, `restore`, `keep`) have no generic implementation:
     * they act on a SPECIFIC revision, which only exists as a concept
     * inside the History tab's own per-row UI (Task 10) — a top-level
     * menu/shortcut has no "which revision" to act on, so those three stay
     * unwired. See the task report for the full reasoning.
     */
    openHistory: () => void;
  };
  find: { show: () => void };
  /**
   * Flips the document between its rendered and raw faces — backs
   * `view.mode` (⌘E). Owned by `FolioDocument`, which holds the mode state,
   * because the same value drives both the menubar entry and what the body
   * renders.
   */
  mode: {
    /**
     * Whether the raw editor is currently mounted. Gates every formatting
     * action — in View mode there is no view to act on.
     */
    editing: boolean;
    toggle: () => void;
  };
  /**
   * Runs a text-formatting command against the live CodeMirror view.
   *
   * A plain callback, not a registration handshake: these are string edits
   * on a document, so the only thing needed from outside is the view. The
   * previous editor required a whole publish/subscribe apparatus because
   * its commands could only be built inside a Lexical realm.
   */
  format: { run: (id: FolioActionId) => void };
}

export interface UseFolioActionsResult {
  handlers: FolioActionHandlers;
  /**
   * True while a protected folio's plaintext has not been loaded into the
   * draft this session (no cached key, and `unlock` hasn't succeeded yet).
   * Always `false` for a non-protected folio.
   */
  locked: boolean;
  /**
   * Passphrase round-trip for the locked panel — see the file doc below.
   */
  unlock: (passphrase: string) => Promise<string | null>;
  /**
   * True while `folio.save`'s request is in flight. NOT the brief's stated
   * return shape — added because the Save button needs a loading signal,
   * and `FolioDraft.saving` (from `useFormState`) never becomes `true` in
   * this wiring: `save()` reads `draft.values` and calls the API directly,
   * it never calls `draft.form.submit()`. Task 7's report flagged this as
   * dead weight it left for Task 8 to resolve; this is that resolution —
   * `saving` here is the one real "is saving" signal, sourced from the
   * `useAction` wrapping `save`.
   */
  saving: boolean;
  /**
   * Everything `folioMenubarModel.isFolioActionEnabled` needs to decide
   * what's clickable. Not in the brief's stated return shape, but computed
   * here deliberately: `isProtected`/`isPinned` are tracked as LOCAL state
   * (see the file doc's "why local state" note below), not read from
   * `props.folio` on every render. A menubar built in a later task that
   * re-derived them from `folio.protected`/`folio.pinned` directly would
   * reintroduce the exact staleness this hook exists to avoid.
   */
  actionState: FolioActionState;
  /**
   * The folio's CURRENT directory — local state for the same reason as
   * `isProtected`/`protectedSalt`/`isPinned` above, caught the same way
   * (live testing, not review): `props.folio.directoryId` is a
   * route-loader snapshot, and `confirmMove` mutates the row without a
   * remount. Reading `props.folio.directoryId` directly for display would
   * keep showing the OLD directory after a successful in-session move.
   * `undefined` means the project root.
   */
  directoryId?: string;
  moveDialogOpen: boolean;
  closeMoveDialog: () => void;
  confirmMove: (directoryId: string | null) => Promise<void>;
  encryptDialogOpen: boolean;
  closeEncryptDialog: () => void;
  confirmEncrypt: (passphrase: string) => Promise<string | null>;
  /**
   * Sync the workspace after a history revert (the inspector's History
   * tab, Task 10). See the function's own doc below for why this can't be
   * left to `props.folio` re-rendering on its own.
   */
  applyReverted: (folio: Folio) => Promise<void>;
}

/**
 * Owns every mutation the folio workspace can perform: save, pin,
 * duplicate, export, encrypt (and its reverse, remove protection), delete,
 * move — plus dispatching the pane-toggle and find-in-folio actions the
 * menubar/toolbar (Tasks 9–11) will trigger. Returns one handler per
 * `FolioActionId` so a menu, a toolbar button and a keyboard shortcut can
 * all call the same function.
 *
 * ## Why `isProtected`/`isPinned` are local state, not `props.folio.*`
 *
 * `FolioWorkspace` remounts this whole subtree (via a `key` on the folio
 * id) on every folio-to-folio navigation — but NOT on an in-place mutation
 * of the SAME folio, like this hook's own `folio.encrypt` or `folio.pin`
 * actions. `props.folio` is a route-loader prop, fixed for the life of this
 * mount; it does not refresh just because `alepha.store.set(currentFolioAtom,
 * ...)` ran. If `isProtected` were computed as `!!props.folio?.protected`
 * on every render (as the brief's own `save()` snippet does), then the
 * FIRST save issued right after an in-session Encrypt would read the STALE
 * `false` and send `protected: false` with the live plaintext draft — which
 * the server treats as a deliberate, permitted "remove protection" request
 * (see `apps/lore/CLAUDE.md`'s protection-domain invariant). That would
 * silently downgrade a folio the user just finished protecting. Local state,
 * seeded once from `props.folio` and updated only by this hook's own
 * successful encrypt/remove-protection calls, avoids that: it is always the
 * CURRENT truth for the actions that can change it, without depending on a
 * remount that isn't guaranteed to happen.
 *
 * ## The security-critical paths — every place `protected` is sent, and why
 *
 * 1. `save()` — always sends `protected: isProtected` (the local state
 *    above) on every `folioApi.update` call, true or false, matching
 *    whatever the row's ACTUAL current state is. Never omitted (the server
 *    rejects an omitted `protected` against a protected row that also sends
 *    `content`), never a stale/wrong value. When `isProtected` is true, the
 *    content sent is freshly re-encrypted with the session's cached key —
 *    or the save is BLOCKED (not downgraded) if that key is missing.
 * 2. `duplicate()` — creates a NEW row. If the source is protected, the
 *    new row is created `protected: true` too (re-encrypted with the same
 *    cached key and the SAME salt as the source's envelope — an
 *    independent envelope, since `encryptWithPassphrase` still draws a
 *    fresh IV). This is a deliberate deviation from the brief's Step 6
 *    (which doesn't mention `protected` for duplicate at all): shipping a
 *    silent plaintext copy of a folio the user chose to protect would be a
 *    worse outcome than the brief's omission suggests.
 * 3. `confirmEncrypt()` — the NOT-yet-protected → protected transition.
 *    Sends `protected: true` with a freshly derived key (new passphrase,
 *    new random salt) encrypting the CURRENT draft content. Only reachable
 *    through the passphrase dialog the user just filled in.
 * 4. The remove-protection action (inside the `folio.encrypt` handler when
 *    `isProtected` is already true) — sends `protected: false` together
 *    with `draft.values.content`, which at that point is guaranteed to be
 *    real plaintext (the action is blocked while `locked`). This is the
 *    ONE deliberate, user-confirmed (via `dialog.confirm`) path that sends
 *    `protected: false` with content — exactly the shape the server
 *    accepts as "explicit removal", never folded into a generic save.
 *
 * `folio.move`, `folio.pin` and `folio.delete` never send `content` at all,
 * so the server's protected-content guard never engages for them and
 * `protected` doesn't need to be sent (omitting it preserves the row's
 * current value). The meta bar's tag add/remove only mutate the draft
 * buffer — they go through `save()` like any other edit, not a separate
 * request.
 *
 * ## The same "props.folio is frozen" premise, applied twice, with opposite
 * ## correct answers
 *
 * `isProtected`/`isPinned`/`unlocked` being LOCAL STATE (not re-read from
 * `input.folio` every render) is what keeps them correct. `save()` and
 * `duplicate()` re-encrypting against `protectedSalt` (also local state,
 * NOT `parseProtectedEnvelope(input.folio.content)`) is the same fix for
 * the same underlying cause, applied to the envelope instead of the flags:
 * `input.folio.content` is ALSO a route-loader snapshot, frozen at whatever
 * it was on mount. After an in-session `confirmEncrypt`, that snapshot is
 * still the PRE-encryption plaintext markdown — parsing it as a crypto
 * envelope returns `null`, and every save/duplicate after an in-session
 * Encrypt would refuse with "invalid envelope" until a full page reload
 * re-fetched the row. Both problems have the same shape (a value computed
 * fresh from `input.folio` on every render is wrong the moment something in
 * THIS hook changes what's actually persisted) and the same fix (track it
 * as local state seeded once, moved only by this hook's own successful
 * writes).
 */
export const useFolioActions = (
  input: UseFolioActionsInput,
): UseFolioActionsResult => {
  const { tr } = useI18n<I18n, "en">();
  const alepha = useAlepha();
  const router = useRouter<AppRouter>();
  const dialog = useDialog();
  const toaster = useToast();
  const cryptoProvider = useInject(CryptoProvider);
  const folioApi = useClient<FolioController>();
  const [project] = useStore(currentProjectAtom);
  const [folios, setFolios] = useStore(userFoliosAtom);
  const projectSlug = project ? project.slug : "";

  // Seeded once from the loader-provided `folio` prop. Safe as an
  // INITIALIZER only because `FolioWorkspace` remounts this whole subtree
  // on every folio switch (see the file doc above) — these are the local
  // source of truth for the rest of this hook's lifetime, not re-derived
  // from `input.folio` on later renders.
  const [isProtected, setIsProtected] = useState<boolean>(
    !!input.folio?.protected,
  );
  const [isPinned, setIsPinned] = useState<boolean>(!!input.folio?.pinned);
  // Whether THIS session already holds the plaintext + key for a protected
  // folio. Irrelevant (and ignored) once `isProtected` is false.
  const [unlocked, setUnlocked] = useState<boolean>(!input.folio?.protected);
  // The current envelope's salt — needed by `save()`/`duplicate()` to
  // re-encrypt into the SAME envelope family. Seeded from `input.folio`
  // (correct at mount) but, like `isProtected`/`isPinned`, moved by THIS
  // hook's own successful transitions rather than re-read from
  // `input.folio.content` later. `input.folio` is the route-loader prop —
  // frozen for the mount's lifetime — so after an in-session `confirmEncrypt`
  // establishes a brand new envelope, `input.folio.content` is still the
  // PRE-encryption plaintext markdown. Parsing that as an envelope returns
  // `null`, and every save/duplicate after an in-session Encrypt would
  // refuse with "invalid envelope" until a full reload re-fetched the row.
  // Tracking the salt locally (updated the moment `confirmEncrypt` succeeds)
  // closes that gap the same way `isProtected`/`isPinned` close theirs.
  const [protectedSalt, setProtectedSalt] = useState<string | undefined>(() =>
    input.folio?.protected
      ? (parseProtectedEnvelope(input.folio.content)?.salt ?? undefined)
      : undefined,
  );
  // Same reasoning again, caught this round by actually clicking through
  // the move flow: `input.folio.directoryId` is ALSO a route-loader
  // snapshot. Without this, `confirmMove` correctly persists the new
  // directory server-side (verified directly against the dev DB), but the
  // meta bar's chip kept showing the folio's OLD directory until a full
  // reload — `FolioDocument` had no live value to read instead. Seeded
  // from `input.folio`, moved only by `confirmMove`'s own success.
  const [currentDirectoryId, setCurrentDirectoryId] = useState<
    string | undefined
  >(input.folio?.directoryId);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [encryptDialogOpen, setEncryptDialogOpen] = useState(false);

  // Edit▸Bold, Insert▸Table and friends dispatch MDXEditor's own realm
  // commands, reachable ONLY from inside its realm provider —
  const locked = isProtected && !unlocked;

  // Writes the freshly decrypted plaintext into the draft AND re-baselines
  // `dirty` against it — not just the former. `useFolioDraft.initial()`
  // blanks `content` to `""` for a protected folio (so ciphertext never
  // paints), which becomes the `dirty`-comparison baseline. Setting the
  // live value to the real plaintext without ALSO moving the baseline left
  // the two permanently apart: `dirty` compared the just-decrypted
  // plaintext against a baseline of `""` and read `true` forever after
  // unlock, so the status line read "Unsaved changes" the instant a folio
  // was unlocked, before the user touched anything. `folio.updatedAt` is
  // the correct "as of" timestamp — decrypting doesn't change what the
  // server holds.
  const applyDecryptedContent = (folio: Folio, plaintext: string): void => {
    input.draft.form.input.content.set(plaintext);
    // Live read, not `input.draft.values` — see `getLiveValues`'s doc.
    // Title/summary aren't usually mid-edit during an unlock, but
    // reading them live costs nothing and removes the same staleness class
    // of bug from this call site too.
    const live = input.draft.getLiveValues();
    const baselineValues: FolioDraftValues = {
      title: live.title,
      summary: live.summary,
      content: plaintext,
    };
    input.draft.markSaved(folio.updatedAt, baselineValues);
    setUnlocked(true);
  };

  /**
   * Sync the workspace after a history revert (the inspector's History
   * tab, Task 10). `revertHistory` reverts the ROW server-side and
   * returns the new state, but nothing about THIS hook's local state
   * refreshes itself just because that happened — the same "props.folio
   * is frozen" premise documented at the top of this file, generalized
   * one step further: a revert can change title/summary/content all
   * at once (whichever fields the reverted-to revision's snapshot held),
   * not just `content` the way `applyDecryptedContent` alone handles it
   * for unlock. So title/summary are written into the live form
   * FIRST, then `applyDecryptedContent` sets content and re-baselines
   * `dirty` against all four together.
   *
   * Protected folios: `reverted.content` is the OLD ciphertext from that
   * revision (same salt — revisions never cross a protection-domain
   * boundary, purged instead; see `apps/lore/CLAUDE.md`'s
   * protection-domain invariant), so it has to be decrypted with the
   * cached key before it can be shown. If this session never unlocked
   * the folio (no cached key), there is no safe way to reflect the
   * revert in THIS draft — the row IS reverted server-side regardless,
   * and unlocking afterward decrypts the (already-reverted) content
   * correctly, so nothing is lost, it just isn't shown until then.
   *
   * Every branch below moves `draft.savedAt`, even the ones that can't
   * touch `content` (no cached key, or a decrypt failure) — the
   * inspector's `FolioHistoryTab` keys its `listHistory` fetch effect on
   * `savedAt` (threaded down as `refreshedAt`) specifically so it
   * notices a save made from elsewhere. A revert IS such a save: the
   * server-side row changed (a new "Reverted" revision now exists)
   * regardless of what the client can decrypt to show for it, so the
   * History tab needs to refetch in EVERY case, not just the one where
   * content happened to update too. This is also why `FolioHistoryTab`
   * itself no longer calls its own `refresh()` after a revert — a second,
   * separate `listHistory` call landing at nearly the same moment as this
   * one was a wasted round-trip, not a correctness difference.
   *
   * The two branches that can't call `applyDecryptedContent` use
   * `draft.touchSavedAt`, NOT `draft.markSaved`. This distinction is
   * load-bearing, not stylistic: `locked` (`isProtected && !unlocked`) is
   * what gates whether the title/summary fields are `disabled`, but
   * `unlocked` is React state while the cached key it's meant to track
   * lives in `protectedFolioKeys.ts`'s module-level cache —
   * `ensureProtectedKeysAutoLock` can evict that cache after 15 idle
   * minutes (or sooner, hidden) WITHOUT resetting `unlocked`. So the
   * `!cachedKey` branch below is reachable with `locked === false`: the
   * fields are still fully editable, and the user may have real,
   * never-persisted edits sitting in the live buffer at the exact moment
   * a revert (from the History tab, of an OLDER revision) lands. Calling
   * `markSaved(reverted.updatedAt, getLiveValues())` there would adopt
   * those live edits as the new `dirty`-comparison baseline — silently
   * marking un-persisted work "Saved" without ever sending it anywhere.
   * `save()` treats this exact condition (not `locked`, no cached key) as
   * an error and refuses; a revert must not treat it as success by
   * accident. `touchSavedAt` moves only the timestamp `FolioHistoryTab`
   * needs, leaving `baseline` (and therefore `dirty`) exactly where it
   * was — a genuinely diverged buffer keeps reading "Unsaved changes".
   */
  const applyReverted = async (reverted: Folio): Promise<void> => {
    const syncAtoms = (): void => {
      alepha.store.set(currentFolioAtom, reverted);
      setFolios(folios.map((f) => (f.id === reverted.id ? reverted : f)));
    };
    // Move `savedAt` alone — see this function's own doc for why this is
    // NOT `markSaved(reverted.updatedAt, input.draft.getLiveValues())`.
    const bumpSavedAt = (): void => {
      input.draft.touchSavedAt(reverted.updatedAt);
    };

    if (isProtected) {
      const cachedKey = locked ? undefined : getProtectedKey(reverted.id);
      if (!cachedKey) {
        bumpSavedAt();
        syncAtoms();
        return;
      }
      try {
        const plaintext = await decryptEnvelopeWithKey(
          cachedKey,
          reverted.content,
        );
        input.draft.form.input.title.set(reverted.title);
        input.draft.form.input.summary.set(reverted.summary);
        applyDecryptedContent(reverted, plaintext);
      } catch {
        toaster.error(tr("folios.protected.unlock-failed"));
        bumpSavedAt();
      }
      syncAtoms();
      return;
    }

    input.draft.form.input.title.set(reverted.title);
    input.draft.form.input.summary.set(reverted.summary);
    applyDecryptedContent(reverted, reverted.content);
    syncAtoms();
  };

  // If a passphrase was already entered for this folio earlier in the
  // session (the cache in `protectedFolioKeys.ts` — module-level, survives
  // navigation within the tab), decrypt quietly on mount instead of making
  // the user re-enter it. Ported from the deleted `FolioEditor.tsx`'s own
  // mount effect. `input.folio?.id` is enough as a dep: a folio SWITCH
  // remounts this hook entirely (see the file doc), so this only ever
  // needs to run once for "the same folio, freshly mounted".
  useEffect(() => {
    const folio = input.folio;
    if (!folio?.protected) return;
    const cached = getProtectedKey(folio.id);
    if (!cached) return;
    let alive = true;
    (async () => {
      try {
        const plaintext = await decryptEnvelopeWithKey(cached, folio.content);
        if (!alive) return;
        applyDecryptedContent(folio, plaintext);
      } catch {
        // Stale/incompatible cached key — fall back to the locked gate,
        // which will re-prompt via `unlock`.
        forgetProtectedKey(folio.id);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.folio?.id]);

  const unlock = async (passphrase: string): Promise<string | null> => {
    const folio = input.folio;
    if (!folio) return null;
    const envelope = parseProtectedEnvelope(folio.content);
    if (!envelope) return tr("folios.protected.invalid-envelope");
    try {
      const key = await cryptoProvider.deriveKeyFromPassphrase(
        passphrase,
        envelope.salt,
        envelope.iterations,
      );
      const plaintext = await decryptEnvelopeWithKey(key, folio.content);
      rememberProtectedKey(folio.id, key);
      ensureProtectedKeysAutoLock();
      applyDecryptedContent(folio, plaintext);
      return null;
    } catch {
      // Web Crypto throws a generic OperationError on a bad passphrase or
      // a corrupt envelope — never distinguish which in the message.
      return tr("folios.protected.unlock-failed");
    }
  };

  const save = async (): Promise<void> => {
    const folio = input.folio;
    if (!folio && !project) {
      // Unreachable in practice — the project route loader always
      // populates `currentProjectAtom` before this page renders — but
      // `folioApi.create` below needs `project.id`, so guard rather than
      // risk a non-null assertion throwing on a real `undefined`.
      return;
    }
    // Live read — see `getLiveValues`'s doc on `FolioDraft`. Using the
    // per-render `values` snapshot here was the root cause of a real bug:
    // re-reading it again below (post-`await`) returned the SAME frozen
    // object every time, because `input` (and therefore `input.draft`) is
    // fixed for the lifetime of this closure — it does not track later
    // renders just because the user kept typing.
    const values = input.draft.getLiveValues();

    let contentToSend = values.content;
    if (isProtected) {
      if (locked || !folio) {
        toaster.error(tr("folios.protected.unlock-before-edit"));
        return;
      }
      const cachedKey = getProtectedKey(folio.id);
      if (!cachedKey) {
        toaster.error(tr("folios.protected.unlock-before-edit"));
        return;
      }
      // `protectedSalt` (local state), NOT `parseProtectedEnvelope(folio.content)`
      // — see the state declaration's doc. `folio.content` is the
      // route-loader snapshot; after an in-session `confirmEncrypt` it is
      // still the pre-encryption plaintext, which fails to parse as an
      // envelope and would refuse every save with "invalid envelope"
      // until a full reload.
      if (!protectedSalt) {
        toaster.error(tr("folios.protected.invalid-envelope"));
        return;
      }
      contentToSend = await cryptoProvider.encryptWithPassphrase(
        values.content,
        cachedKey,
        protectedSalt,
      );
      rememberProtectedKey(folio.id, cachedKey);
    }

    const title = values.title.trim() || tr("folios.title-placeholder");

    const saved = folio
      ? await folioApi.update({
          params: { id: folio.id },
          body: {
            title,
            summary: values.summary,
            content: contentToSend,
            protected: isProtected,
          },
        })
      : await folioApi.create({
          body: {
            title,
            summary: values.summary,
            content: contentToSend,
            protected: false,
            projectId: project!.id,
            directoryId: input.directoryId,
          },
        });

    alepha.store.set(currentFolioAtom, saved as Folio);
    let nextFolios = folio
      ? folios.map((f) => (f.id === saved.id ? (saved as Folio) : f))
      : [saved as Folio, ...folios];
    setFolios(nextFolios);
    input.draft.markSaved(saved.updatedAt, { ...values, title });

    if (!folio) {
      // Create mode: `router.push` below changes `FolioWorkspace`'s `key`
      // from "new" to the folio id, which fully remounts the workspace —
      // the fresh mount's `useFolioDraft` seeds from the NEW page's own
      // loader, which refetches the folio from the server. `getLiveValues()`
      // here is a SECOND, genuinely live read (see its doc) — if the user
      // kept typing during the `await folioApi.create` above, this sees it,
      // where re-reading the `values` snapshot would not have. Without
      // catching the server up before navigating, that typing would be
      // silently discarded by the remount while the status line still
      // read "Saved".
      const latest = input.draft.getLiveValues();
      if (!sameValues(latest, { ...values, title })) {
        const latestTitle =
          latest.title.trim() || tr("folios.title-placeholder");
        const caughtUp = await folioApi.update({
          params: { id: saved.id },
          body: {
            title: latestTitle,
            summary: latest.summary,
            content: latest.content,
          },
        });
        alepha.store.set(currentFolioAtom, caughtUp as Folio);
        nextFolios = nextFolios.map((f) =>
          f.id === caughtUp.id ? (caughtUp as Folio) : f,
        );
        setFolios(nextFolios);
        input.draft.markSaved(caughtUp.updatedAt, {
          ...latest,
          title: latestTitle,
        });
      }
      await router.push(
        router.path("projectFoliosFolio", {
          params: { projectSlug, shortId: saved.shortId },
        }),
      );
    }
  };

  const saveAction = useAction(
    { handler: save, invalidates: [["folioTree", projectSlug]] },
    [
      isProtected,
      locked,
      protectedSalt,
      input.folio,
      input.directoryId,
      input.draft,
      project,
      folioApi,
      folios,
      setFolios,
      alepha,
      router,
      projectSlug,
      tr,
      toaster,
      cryptoProvider,
    ],
  );

  const duplicateAction = useAction(
    {
      handler: async () => {
        const folio = input.folio;
        if (!folio || !project) return;
        if (isProtected && locked) {
          toaster.error(tr("folios.protected.unlock-before-edit"));
          return;
        }
        const values = input.draft.getLiveValues();
        let contentToSend = values.content;
        let keyForDuplicate: CryptoKey | undefined;
        if (isProtected) {
          keyForDuplicate = getProtectedKey(folio.id);
          if (!keyForDuplicate) {
            toaster.error(tr("folios.protected.unlock-before-edit"));
            return;
          }
          // `protectedSalt`, not `parseProtectedEnvelope(folio.content)` —
          // same staleness reasoning as `save()`.
          if (!protectedSalt) {
            toaster.error(tr("folios.protected.invalid-envelope"));
            return;
          }
          contentToSend = await cryptoProvider.encryptWithPassphrase(
            values.content,
            keyForDuplicate,
            protectedSalt,
          );
        }
        const created = await folioApi.create({
          body: {
            title: `${values.title.trim() || tr("folios.title-placeholder")}${tr("folio.action.duplicate-suffix")}`,
            summary: values.summary,
            content: contentToSend,
            protected: isProtected,
            projectId: project.id,
            // `currentDirectoryId` (local state, moved by `confirmMove`'s
            // own success), NOT `folio.directoryId` — the same staleness
            // fix already applied to the Move dialog's starting point in
            // `FolioDocument.tsx` (`props.actions.directoryId ??
            // props.directoryId`). `folio` is `input.folio`, the
            // route-loader prop, frozen for the mount's lifetime: after an
            // in-session move via the tree (Task 9) or the menubar's own
            // "Move to…" dialog, `folio.directoryId` still reads the OLD
            // directory, so a duplicate made after that move would file
            // the copy back under the folio's pre-move location instead of
            // where it now actually lives.
            directoryId: currentDirectoryId,
          },
        });
        if (isProtected && keyForDuplicate) {
          rememberProtectedKey(created.id, keyForDuplicate);
          ensureProtectedKeysAutoLock();
        }
        alepha.store.set(currentFolioAtom, created as Folio);
        setFolios([created as Folio, ...folios]);
        await router.push(
          router.path("projectFoliosFolio", {
            params: { projectSlug, shortId: created.shortId },
          }),
        );
      },
      invalidates: [["folioTree", projectSlug]],
    },
    [
      input.folio,
      input.draft,
      project,
      isProtected,
      locked,
      protectedSalt,
      currentDirectoryId,
      folioApi,
      folios,
      setFolios,
      alepha,
      router,
      projectSlug,
      tr,
      toaster,
      cryptoProvider,
    ],
  );

  const pinAction = useAction(
    {
      handler: async () => {
        const folio = input.folio;
        if (!folio) return;
        const next = !isPinned;
        const updated = await folioApi.update({
          params: { id: folio.id },
          body: { pinned: next },
        });
        setIsPinned(next);
        alepha.store.set(currentFolioAtom, updated as Folio);
        setFolios(
          folios.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)),
        );
      },
      invalidates: [["folioTree", projectSlug]],
    },
    [input.folio, isPinned, folioApi, folios, setFolios, alepha, projectSlug],
  );

  const deleteAction = useAction(
    {
      handler: async () => {
        const folio = input.folio;
        if (!folio) return;
        await folioApi.delete({ params: { id: folio.id } });
        setFolios(folios.filter((f) => f.id !== folio.id));
        alepha.store.set(currentFolioAtom, undefined);
        await router.push(
          router.path("projectFolios", { params: { projectSlug } }),
        );
      },
      invalidates: [["folioTree", projectSlug]],
    },
    [input.folio, folios, setFolios, alepha, router, projectSlug, folioApi],
  );

  const handleDelete = async (): Promise<void> => {
    const confirmed = await dialog.confirm({
      title: tr("folios.confirm-delete-title"),
      description: tr("folios.confirm-delete-message"),
      destructive: true,
    });
    if (confirmed) await deleteAction.run();
  };

  const removeProtectionAction = useAction(
    {
      handler: async () => {
        const folio = input.folio;
        if (!folio || locked) return;
        const confirmed = await dialog.confirm({
          title: tr("folios.protected.remove-confirm-title"),
          description: tr("folios.protected.remove-confirm-body"),
          destructive: true,
        });
        if (!confirmed) return;
        const values = input.draft.getLiveValues();
        const updated = await folioApi.update({
          params: { id: folio.id },
          body: {
            title: values.title,
            summary: values.summary,
            content: values.content,
            protected: false,
          },
        });
        forgetProtectedKey(folio.id);
        setIsProtected(false);
        setUnlocked(true);
        setProtectedSalt(undefined);
        alepha.store.set(currentFolioAtom, updated as Folio);
        setFolios(
          folios.map((f) => (f.id === updated.id ? (updated as Folio) : f)),
        );
        input.draft.markSaved(updated.updatedAt, values);
      },
      invalidates: [["folioTree", projectSlug]],
    },
    [
      input.folio,
      input.draft,
      locked,
      dialog,
      tr,
      folioApi,
      folios,
      setFolios,
      alepha,
      projectSlug,
    ],
  );

  // `useAction`-wrapped (unlike the brief's given shape) so a failure gets
  // `["folioTree", projectSlug]` invalidation and the same `react:action:error`
  // event every other mutation here emits, instead of an unhandled
  // rejection. The try/catch stays INSIDE the handler and always returns a
  // string, never throws: `confirmEncrypt`'s contract
  // (`FolioPassphraseDialogProps.onSubmit`) is "return an error message, or
  // null on success" — if the handler threw instead, `useAction` would
  // swallow it into `.error` state and resolve `run()` to `undefined`, and
  // `?? null` below would then read that as SUCCESS and close the dialog
  // over a failed encrypt.
  const confirmEncryptAction = useAction<[string], string | null>(
    {
      handler: async (passphrase) => {
        const folio = input.folio;
        if (!folio) return null;
        try {
          const saltHex = cryptoProvider.randomUUID().replace(/-/g, "");
          const key = await cryptoProvider.deriveKeyFromPassphrase(
            passphrase,
            saltHex,
          );
          const values = input.draft.getLiveValues();
          const envelope = await cryptoProvider.encryptWithPassphrase(
            values.content,
            key,
            saltHex,
          );
          const updated = await folioApi.update({
            params: { id: folio.id },
            body: {
              title: values.title,
              summary: values.summary,
              content: envelope,
              protected: true,
            },
          });
          rememberProtectedKey(updated.id, key);
          ensureProtectedKeysAutoLock();
          setIsProtected(true);
          setUnlocked(true);
          setProtectedSalt(saltHex);
          alepha.store.set(currentFolioAtom, updated as Folio);
          setFolios(
            folios.map((f) => (f.id === updated.id ? (updated as Folio) : f)),
          );
          input.draft.markSaved(updated.updatedAt, values);
          setEncryptDialogOpen(false);
          return null;
        } catch {
          return tr("folios.protected.encrypt-failed");
        }
      },
      invalidates: [["folioTree", projectSlug]],
    },
    [
      input.folio,
      input.draft,
      cryptoProvider,
      folioApi,
      folios,
      setFolios,
      alepha,
      projectSlug,
      tr,
    ],
  );

  const confirmEncrypt = (passphrase: string): Promise<string | null> =>
    confirmEncryptAction.run(passphrase).then((result) => result ?? null);

  // Also `useAction`-wrapped — `FolioMoveDialog.handleConfirm` previously
  // `await`ed a plain async function with no try/catch of its own, so a
  // failed `folioApi.update` became an unhandled rejection: the dialog was
  // left open with `picked` still set and no feedback, effectively stuck.
  // `useAction` catches the error internally (never re-throws), so
  // `handleConfirm`'s `await` now always resolves — on failure the dialog
  // correctly stays open (only a SUCCESSFUL run calls
  // `setMoveDialogOpen(false)`) instead of being left in an ambiguous state.
  const confirmMoveAction = useAction<[string | null], void>(
    {
      handler: async (directoryId) => {
        const folio = input.folio;
        if (!folio) return;
        const updated = await folioApi.update({
          params: { id: folio.id },
          body: { directoryId },
        });
        alepha.store.set(currentFolioAtom, updated as Folio);
        setFolios(
          folios.map((f) => (f.id === updated.id ? (updated as Folio) : f)),
        );
        setCurrentDirectoryId(directoryId ?? undefined);
        setMoveDialogOpen(false);
      },
      invalidates: [["folioTree", projectSlug]],
    },
    [input.folio, folioApi, folios, setFolios, alepha, projectSlug],
  );

  const confirmMove = async (directoryId: string | null): Promise<void> => {
    await confirmMoveAction.run(directoryId);
  };

  const exportFolio = (): void => {
    const folio = input.folio;
    if (!folio) return;
    if (isProtected && locked) {
      toaster.error(tr("folios.protected.unlock-before-edit"));
      return;
    }
    // Deliberate divergence from `FolioBrowser.tsx`'s row-level download,
    // which refuses ANY protected folio outright (it only ever has the
    // ciphertext `folioApi.get` returns, never a decrypted body). Here the
    // user has already unlocked this exact folio in this exact tab — the
    // plaintext is legitimately on screen — so exporting it is exporting
    // what they can already read, not a new disclosure. Recorded as a
    // disclosed choice, not an oversight: the two exports are not held to
    // the same rule on purpose.
    const values = input.draft.getLiveValues();
    const markdown = folioMarkdownExport({
      ...folio,
      title: values.title,
      summary: values.summary,
      content: values.content,
    });
    const stem = folioExportFilename(values.title);
    const attachments = alepha.store.get(currentFolioBlobsAtom) ?? [];
    if (attachments.length === 0) {
      triggerFolioDownload(
        `${stem}.md`,
        markdown,
        "text/markdown;charset=utf-8",
      );
      return;
    }
    void exportZip(stem, markdown, attachments);
  };

  /**
   * A folio with attachments exports as a `.zip`: the markdown at the root
   * and every attachment under `assets/`, which is exactly what the stored
   * content already refers to — so nothing is rewritten on the way out and
   * the unzipped folder opens in any markdown viewer.
   *
   * Materialised with `.blob()` rather than streamed: `<a download>` cannot
   * consume a `ReadableStream`. `ZipArchive`'s streaming design buys nothing
   * here and everything on a future server-side project export.
   */
  const exportZip = async (
    stem: string,
    markdown: string,
    attachments: Array<{ id: string; name: string; mimeType: string }>,
  ): Promise<void> => {
    try {
      const fetched = await Promise.all(
        attachments.map(async (attachment) => {
          const response = await fetch(`/api/files/${attachment.id}`, {
            credentials: "include",
          });
          if (!response.ok) {
            throw new AlephaError(`${attachment.name} (${response.status})`);
          }
          return {
            name: attachment.name,
            mimeType: attachment.mimeType,
            data: new Uint8Array(
              await response.arrayBuffer(),
            ) as Uint8Array<ArrayBuffer>,
          };
        }),
      );

      const archive = await new Response(
        new ZipArchive().create(
          folioZipEntries({ filename: stem, markdown, attachments: fetched }),
        ),
      ).blob();

      triggerFolioDownload(`${stem}.zip`, archive, "application/zip");
    } catch (error) {
      // A partial archive is worse than none: it would look like a complete
      // export while silently missing an image.
      toaster.error(
        `${tr("folios.editor.export.zip-failed")} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  // `history.compare` / `history.restore` / `history.keep` are not this
  // task's job to wire (see the report): each acts on a SPECIFIC revision,
  // a concept that only exists inside the History tab's own per-row UI
  // (Task 10) — there is no generic "the current one" a top-level
  // menu/shortcut could mean. `folio.newDirectory` needs a name-prompt +
  // directory-create flow that more naturally belongs with the tree pane's
  // own creation UI (Task 9).
  const notYetWired = (): void => {};

  const handlers: FolioActionHandlers = {
    "folio.new": () => {
      if (!project) return;
      router.push(router.path("projectFoliosNew", { params: { projectSlug } }));
    },
    "folio.newDirectory": notYetWired,
    "folio.save": () => {
      saveAction.run();
    },
    "folio.duplicate": () => {
      duplicateAction.run();
    },
    "folio.move": () => {
      // Defense in depth: the meta bar's directory chip is already
      // disabled in create mode (see `FolioDocument.tsx`), so nothing in
      // Task 8 can reach this with `input.folio` unset — but a future
      // menu/shortcut wired straight to `handlers` without consulting
      // `isFolioActionEnabled` (which already excludes `folio.move` while
      // `isNew`) would otherwise open a dialog whose Confirm silently does
      // nothing (`confirmMove` returns early on a missing folio, before
      // ever closing the dialog).
      if (!input.folio) return;
      setMoveDialogOpen(true);
    },
    "folio.pin": () => {
      pinAction.run();
    },
    "folio.export": exportFolio,
    "folio.encrypt": () => {
      if (!isProtected) {
        setEncryptDialogOpen(true);
        return;
      }
      if (locked) {
        toaster.error(tr("folios.protected.unlock-before-edit"));
        return;
      }
      removeProtectionAction.run();
    },
    "folio.delete": () => {
      handleDelete();
    },
    "edit.bold": () => input.format.run("edit.bold"),
    "edit.italic": () => input.format.run("edit.italic"),
    "edit.code": () => input.format.run("edit.code"),
    "insert.heading1": () => input.format.run("insert.heading1"),
    "insert.heading2": () => input.format.run("insert.heading2"),
    "insert.heading3": () => input.format.run("insert.heading3"),
    "insert.bulletList": () => input.format.run("insert.bulletList"),
    "insert.numberedList": () => input.format.run("insert.numberedList"),
    "insert.quote": () => input.format.run("insert.quote"),
    "insert.table": () => input.format.run("insert.table"),
    "insert.codeBlock": () => input.format.run("insert.codeBlock"),
    "insert.diagram": () => input.format.run("insert.diagram"),
    "insert.divider": () => input.format.run("insert.divider"),
    "edit.find": () => input.find.show(),
    "view.mode": () => input.mode.toggle(),
    "view.tree": () => input.panes.toggleTree(),
    "view.inspector": () => input.panes.toggleInspector(),
    "view.focus": () => input.panes.toggleFocus(),
    "history.revisions": () => input.panes.openHistory(),
    "history.compare": notYetWired,
    "history.restore": notYetWired,
    "history.keep": notYetWired,
  };

  const actionState: FolioActionState = {
    locked,
    isNew: !input.folio,
    dirty: input.draft.dirty,
    isProtected,
    isPinned,
    editing: input.mode.editing,
  };

  return {
    handlers,
    locked,
    unlock,
    saving: saveAction.loading,
    actionState,
    directoryId: currentDirectoryId,
    moveDialogOpen,
    closeMoveDialog: () => setMoveDialogOpen(false),
    confirmMove,
    encryptDialogOpen,
    closeEncryptDialog: () => setEncryptDialogOpen(false),
    confirmEncrypt,
    applyReverted,
  };
};

// ---------------------------------------------------------------------------
// Protected-envelope helpers. Deliberately NOT reimplementing the crypto
// ceremony (PBKDF2 derivation, AES-GCM) — these are the same hex/JSON
// plumbing `FolioProtectedView.tsx` and the deleted `FolioEditor.tsx` each
// already carried around a cached `CryptoKey`, duplicated here rather than
// imported because they are private helpers in a component, not exported
// utilities.
// ---------------------------------------------------------------------------

const parseProtectedEnvelope = (
  raw: string,
): { salt: string; iterations: number } | null => {
  try {
    const parsed = JSON.parse(raw) as {
      salt?: string;
      kdf?: { iterations?: number };
    };
    if (!parsed.salt) return null;
    return {
      salt: parsed.salt,
      iterations: parsed.kdf?.iterations ?? 600_000,
    };
  } catch {
    return null;
  }
};

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
  }
  return out;
};

const decryptEnvelopeWithKey = async (
  key: CryptoKey,
  envelopeRaw: string,
): Promise<string> => {
  const env = JSON.parse(envelopeRaw) as { iv: string; ciphertext: string };
  const ivBytes = hexToBytes(env.iv);
  const ctBytes = hexToBytes(env.ciphertext);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes.buffer as ArrayBuffer },
    key,
    ctBytes.buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(decrypted);
};
