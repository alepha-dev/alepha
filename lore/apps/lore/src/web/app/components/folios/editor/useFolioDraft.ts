import { z } from "alepha";
import { useForm, useFormState, useFormValues } from "alepha/react/form";
import { useEffect, useRef, useState } from "react";

import type { Folio } from "@/api/entities/folios.ts";

/**
 * The folio fields the workspace edits. `summary` is edited through
 * `FolioSummaryField` and carried here like the other two.
 */
export const folioDraftSchema = z.object({
  title: z.string().max(200).meta({ title: "Title" }),
  summary: z.string().max(500).meta({ title: "Summary" }).default(""),
  content: z.string().meta({ title: "Content" }).default(""),
});

export interface FolioDraftValues {
  title: string;
  summary: string;
  content: string;
}

export interface FolioDraft {
  form: ReturnType<typeof useForm<typeof folioDraftSchema>>;
  /**
   * Current buffer, already narrowed — `useFormValues` returns a loose
   * record, and every consumer wants these three fields typed.
   */
  values: FolioDraftValues;
  /**
   * True once any field diverges from what was last persisted. Derived by
   * comparison rather than by a flag every field component has to remember
   * to set — one fewer thing to get wrong in nine call sites.
   */
  dirty: boolean;
  saving: boolean;
  /**
   * Which status line to render. `draft` is create mode, `saved` shows the
   * relative save time, `unsaved` warns about pending edits.
   */
  statusKey: "draft" | "saved" | "unsaved";
  savedAt?: string;
  /**
   * Like `savedAt`, but it only moves when the write actually changed the
   * folio's REVISION LIST — which is what `FolioHistoryTab` needs and
   * `savedAt` is too eager to be.
   *
   * They used to be one value. Autosave fires 1.5s after typing stops and
   * the server folds saves inside an HOUR into one revision, so a writing
   * session moved `savedAt` every few seconds while the revision list sat
   * still — and the History tab, keyed on it, refetched up to ten FULL
   * content snapshots each time.
   *
   * `savedAt` keeps its own job: it is what the status line renders as
   * "Saved 2 minutes ago", where every save is worth showing.
   */
  revisionsAt?: string;
  /**
   * Called by the save action with the persisted row's `updatedAt`, which
   * re-baselines `dirty`.
   *
   * `revisionsChanged` is the server's answer for this write (see
   * `folioSavedSchema`) and gates `revisionsAt` alone. It defaults to
   * `true` so a caller that has no such answer — or is reporting something
   * other than a plain save — keeps the old always-refetch behaviour;
   * only the autosave path, which has the flag, opts into the cheap one.
   */
  markSaved: (
    at: string,
    values: FolioDraftValues,
    revisionsChanged?: boolean,
  ) => void;
  /**
   * Move `savedAt` alone, WITHOUT touching the `dirty`-comparison
   * `baseline`. Exists for events that changed the folio SERVER-SIDE
   * (a history revert) but that must NOT be read as "whatever is
   * currently in the buffer just got saved" — `markSaved` conflates the
   * two, which is correct when the caller is actually reporting a
   * successful write of the live values, and wrong when it isn't. Using
   * `markSaved(at, getLiveValues())` for a revert the user didn't
   * initiate through Save would silently adopt in-progress, un-persisted
   * edits as the new baseline — `dirty` would flip to `false` and the
   * status line would falsely read "Saved" over content the server has
   * never seen. `touchSavedAt` only moves the timestamp consumers like
   * `FolioHistoryTab`'s fetch effect key on; a genuinely diverged buffer
   * keeps correctly reading `dirty: true`.
   */
  touchSavedAt: (at: string) => void;
  /**
   * Adopt a title this client did not type, and treat it as persisted.
   *
   * The tree's inline rename PATCHes the row and updates
   * `userFoliosAtom`; it has no way to reach the open editor's buffer,
   * which was seeded from the route loader's snapshot at mount. Every
   * save path then sent that stale `values.title`, so a rename made
   * between the create and the first save was silently overwritten by the
   * editor — the last writer, and the wrong one.
   *
   * Deliberately narrower than `markSaved`, which moves the WHOLE
   * baseline: doing that here would adopt whatever body text is
   * mid-sentence in the buffer as "what the server holds", so the status
   * line would read "Saved" over content the server has never seen. Only
   * the title moves; a diverged body keeps reading `dirty: true`.
   *
   * Deliberately wider than `touchSavedAt`, which moves neither the form
   * nor the baseline: the title genuinely did change on the server, and
   * leaving it out of the baseline would report the adopted title as an
   * unsaved edit.
   */
  adoptTitle: (title: string, at: string) => void;
  /**
   * Read the CURRENT form values directly off the `FormModel`, bypassing
   * the `values` snapshot above.
   *
   * `values` is a plain object rebuilt once per render from
   * `useFormValues(form)` — a `save()`-style async handler that captures
   * `values` (or the `FolioDraft` object containing it) in a closure and
   * reads it again *after* an `await` does NOT see anything typed during
   * that wait: the closure's `values` reference is frozen at whatever it
   * was on the render that created it, and nothing forces that particular
   * closure to re-run just because the user kept typing (React re-renders
   * the component with a NEW closure; the already-invoked async function
   * keeps running with the old one). `form` itself is a different story —
   * `useForm`'s `FormModel` instance is memoized for the life of the
   * mounted component (empty `deps`), so the SAME object is reachable from
   * every closure regardless of which render captured it, and `.set()`
   * mutates its internal store synchronously, independent of React's
   * render cycle. `getLiveValues()` reads through that stable instance, so
   * calling it a second time after an `await` returns whatever is
   * genuinely in the fields right now — not a stale snapshot.
   */
  getLiveValues: () => FolioDraftValues;
}

/**
 * Exported for `useFolioActions`'s create-mode fix: after `folioApi.create`
 * resolves, it re-reads `draft.values` to see whether the user kept typing
 * during the request's round-trip, and needs the same "did anything
 * actually change" comparison this hook already uses for `dirty`.
 */
export const sameValues = (a: FolioDraftValues, b: FolioDraftValues): boolean =>
  a.title === b.title && a.summary === b.summary && a.content === b.content;

/**
 * Owns the workspace's edit buffer. Handing this back as one object keeps
 * `FolioWorkspace` free of five pieces of loose state, and keeps the
 * status line derived rather than hand-maintained.
 *
 * `FolioWorkspace` mounts this hook inside a child keyed on the folio id
 * (see `FolioWorkspace.tsx`), so a switch to a different folio always
 * happens through a full remount rather than through this hook alone —
 * `useForm`'s `FormModel` is cached for the life of its calling component
 * (`useForm.ts`'s `useMemo` uses a default empty `deps`), and both
 * `useFormValues` and `useFormState` subscribe to that one model's events
 * once, at mount, with no re-subscription path. Recreating the model
 * in place (e.g. by keying `useForm` itself on the folio id) would leave
 * those two hooks listening for a model that no longer exists. The reset
 * logic below still re-baselines the SAME folio when it changes under us
 * without an id change (e.g. a revert elsewhere updates `updatedAt`).
 */
export const useFolioDraft = (folio: Folio | undefined): FolioDraft => {
  const initial = (): FolioDraftValues => ({
    title: folio?.title ?? "",
    summary: folio?.summary ?? "",
    // A protected folio's `content` is a crypto envelope. Show nothing
    // until the user unlocks it — otherwise the editor renders ciphertext
    // and a save would persist it as the plaintext body.
    content: folio?.protected ? "" : (folio?.content ?? ""),
  });

  const [savedAt, setSavedAt] = useState<string | undefined>(folio?.updatedAt);
  const [revisionsAt, setRevisionsAt] = useState<string | undefined>(
    folio?.updatedAt,
  );

  // Two refs, deliberately not one. `formInitial` is what gets handed to
  // `useForm` as `initialValues` — the ONLY thing that should ever cause
  // `FormModel.setInitialValues` to wipe the live buffer, and that must
  // happen for exactly one reason: the document underneath changed (a
  // different/updated `folio` prop). `baseline` is the separate "what is
  // currently persisted" comparison target `dirty` is computed against.
  //
  // A save completing must move `baseline` (so `dirty` reports correctly
  // against what the server now holds) WITHOUT moving `formInitial` (so
  // `useForm` never re-triggers `setInitialValues`). If a single ref fed
  // both roles, `markSaved` re-baselining after a save would ALSO reset
  // the form's live values to the pre-save snapshot — discarding anything
  // the user typed during the request's round-trip, silently, with the
  // status line then lying "Saved" over an edit the server never saw.
  const formInitial = useRef<FolioDraftValues>(initial());
  const baseline = useRef<FolioDraftValues>(formInitial.current);

  const form = useForm({
    id: folio ? `folio-${folio.id}` : "folio-new",
    schema: folioDraftSchema,
    initialValues: formInitial.current,
    handler: async () => {
      // Saving is orchestrated by `useFolioActions` — it needs the crypto
      // and API surfaces this hook deliberately does not import.
    },
  });

  const { loading: saving } = useFormState(form, ["loading"]);
  const raw = useFormValues(form);
  const values: FolioDraftValues = {
    title: (raw.title as string) ?? "",
    summary: (raw.summary as string) ?? "",
    content: (raw.content as string) ?? "",
  };

  // Re-baseline (and reset the form) when the SAME folio changes
  // underneath us without an id change — a save from elsewhere (the
  // tree's rename, a revert) should not leave the status line stuck on
  // "unsaved". A folio-to-folio switch does not rely on this effect:
  // `FolioWorkspace` remounts this whole hook via its `key`, so
  // `formInitial.current`/`baseline.current`/`useForm` already start
  // fresh on the correct folio before this ever runs.
  useEffect(() => {
    formInitial.current = initial();
    baseline.current = formInitial.current;
    // Re-seeds the draft when a different folio is opened, alongside the two
    // ref writes it must stay in step with.
    // oxlint-disable-next-line react/set-state-in-effect
    setSavedAt(folio?.updatedAt);
    // The folio underneath changed, so the revision list belongs to a
    // different document (or a different state of this one) than whatever
    // the History tab last fetched. Reset together with `savedAt` — the
    // two only diverge WITHIN one document's editing session. (No second
    // disable directive: the rule fires once per effect, and oxlint fails
    // the build on a directive that suppressed nothing.)
    setRevisionsAt(folio?.updatedAt);
  }, [folio?.id, folio?.updatedAt, folio?.protected]);

  const markSaved = (
    at: string,
    saved: FolioDraftValues,
    revisionsChanged = true,
  ) => {
    // Only `baseline` moves — see the comment above `formInitial`. If the
    // user kept typing while this save was in flight, `values` (the LIVE
    // buffer, untouched by this call) will differ from `saved` (the
    // snapshot that was actually sent), so `dirty` below correctly comes
    // back `true` and the status line reads "Unsaved changes" rather than
    // falsely "Saved".
    baseline.current = saved;
    setSavedAt(at);
    if (revisionsChanged) setRevisionsAt(at);
  };

  const adoptTitle = (title: string, at: string): void => {
    form.input.title.set(title);
    // `baseline` only. `formInitial` is what `useForm` reads as
    // `initialValues`, and moving it would re-trigger `setInitialValues`
    // and wipe the live buffer — losing exactly the unsaved body text this
    // is meant to leave alone.
    baseline.current = { ...baseline.current, title };
    setSavedAt(at);
    // A rename opens a revision of its own, so the History tab's list has
    // moved and its fetch effect keys on this.
    setRevisionsAt(at);
  };

  const touchSavedAt = (at: string): void => {
    setSavedAt(at);
    // Unconditional. Every caller is reporting a server-side change this
    // client did not write through `save()` — today, a history revert,
    // which ALWAYS opens its own revision (`appendRevision` refuses to
    // fold a `revert`). Nothing here has a `revisionsChanged` answer to
    // consult, so the safe reading is that the list moved.
    setRevisionsAt(at);
  };

  const dirty = !sameValues(values, baseline.current);

  const getLiveValues = (): FolioDraftValues => {
    const live = form.currentValues;
    return {
      title: (live.title as string) ?? "",
      summary: (live.summary as string) ?? "",
      content: (live.content as string) ?? "",
    };
  };

  return {
    form,
    values,
    dirty,
    saving,
    statusKey: !folio ? "draft" : dirty ? "unsaved" : "saved",
    savedAt,
    revisionsAt,
    markSaved,
    touchSavedAt,
    adoptTitle,
    getLiveValues,
  };
};
