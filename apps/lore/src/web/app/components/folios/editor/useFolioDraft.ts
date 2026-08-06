import { z } from "alepha";
import { useForm, useFormState, useFormValues } from "alepha/react/form";
import { useEffect, useRef, useState } from "react";
import type { Folio } from "@/api/entities/folios.ts";

/**
 * The folio fields the workspace edits. `summary` is new to the web UI —
 * the column has existed since the MCP tools started writing it, but no
 * browser surface has ever set it. The web UI does not offer a field for
 * it yet either (Task 8 adds `FolioSummaryField`) — it is only carried
 * here so the draft buffer's shape already matches the eventual form.
 */
export const folioDraftSchema = z.object({
  title: z.string().max(200).meta({ title: "Title" }),
  tags: z.array(z.string()).meta({ title: "Tags" }),
  summary: z.string().max(500).meta({ title: "Summary" }).default(""),
  content: z.string().meta({ title: "Content" }).default(""),
});

export interface FolioDraftValues {
  title: string;
  tags: string[];
  summary: string;
  content: string;
}

export interface FolioDraft {
  form: ReturnType<typeof useForm<typeof folioDraftSchema>>;
  /**
   * Current buffer, already narrowed — `useFormValues` returns a loose
   * record, and every consumer wants these four fields typed.
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
   * Called by the save action with the persisted row's `updatedAt`, which
   * re-baselines `dirty`.
   */
  markSaved: (at: string, values: FolioDraftValues) => void;
}

const sameValues = (a: FolioDraftValues, b: FolioDraftValues): boolean =>
  a.title === b.title &&
  a.summary === b.summary &&
  a.content === b.content &&
  a.tags.length === b.tags.length &&
  a.tags.every((tag, i) => tag === b.tags[i]);

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
    tags: folio?.tags ?? [],
    summary: folio?.summary ?? "",
    // A protected folio's `content` is a crypto envelope. Show nothing
    // until the user unlocks it — otherwise the editor renders ciphertext
    // and a save would persist it as the plaintext body.
    content: folio?.protected ? "" : (folio?.content ?? ""),
  });

  const [savedAt, setSavedAt] = useState<string | undefined>(folio?.updatedAt);

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
    tags: (raw.tags as string[]) ?? [],
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
    setSavedAt(folio?.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folio?.id, folio?.updatedAt, folio?.protected]);

  const markSaved = (at: string, saved: FolioDraftValues) => {
    // Only `baseline` moves — see the comment above `formInitial`. If the
    // user kept typing while this save was in flight, `values` (the LIVE
    // buffer, untouched by this call) will differ from `saved` (the
    // snapshot that was actually sent), so `dirty` below correctly comes
    // back `true` and the status line reads "Unsaved changes" rather than
    // falsely "Saved".
    baseline.current = saved;
    setSavedAt(at);
  };

  const dirty = !sameValues(values, baseline.current);

  return {
    form,
    values,
    dirty,
    saving,
    statusKey: !folio ? "draft" : dirty ? "unsaved" : "saved",
    savedAt,
    markSaved,
  };
};
