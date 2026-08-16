import { useEffect, useRef } from "react";
import type { FolioDraftValues } from "./useFolioDraft.ts";

/**
 * How long the document must sit still before an auto-save fires.
 *
 * Short enough that stepping away mid-sentence does not lose the sentence,
 * long enough that ordinary typing does not issue a request per word. The
 * server folds saves inside an hour into one revision
 * (`FolioHistoryService.appendRevision`), so the cost of firing often is a
 * request, never a cluttered history.
 */
const IDLE_MS = 1500;

export interface UseFolioAutoSaveInput {
  /**
   * `false` disables auto-save entirely. Two cases need it:
   *
   * - **create mode**, where saving would silently bring a folio into
   *   existence on the first keystroke, before the author has decided it
   *   should exist;
   * - **a locked protected folio**, where the draft holds ciphertext the
   *   session cannot re-encrypt, so a save would write nonsense.
   */
  enabled: boolean;
  dirty: boolean;
  /**
   * Watched for identity changes to restart the idle timer. The values
   * themselves are not read — a new object per keystroke is exactly the
   * signal this needs.
   */
  values: FolioDraftValues;
  saving: boolean;
  save: () => void;
}

/**
 * Saves the folio a moment after typing stops, and once more on the way out.
 *
 * The Save button and ⌘S stay: they are "save now", and they are what create
 * mode still needs. This only removes the obligation to remember them.
 */
export const useFolioAutoSave = (input: UseFolioAutoSaveInput): void => {
  const saveRef = useRef(input.save);
  saveRef.current = input.save;
  // Read by the unmount effect, which must not re-run when they change —
  // hence refs rather than dependencies.
  const dirtyRef = useRef(input.dirty);
  dirtyRef.current = input.dirty;
  const enabledRef = useRef(input.enabled);
  enabledRef.current = input.enabled;

  useEffect(() => {
    if (!input.enabled || !input.dirty || input.saving) return;
    const timer = setTimeout(() => saveRef.current(), IDLE_MS);
    // Cleanup runs on every re-render caused by a keystroke, which is what
    // makes this a debounce rather than a save every 1.5s.
    return () => clearTimeout(timer);
  }, [input.enabled, input.dirty, input.saving, input.values]);

  useEffect(() => {
    return () => {
      // Leaving with unsaved work — navigating to another folio, closing
      // the pane — would otherwise drop up to `IDLE_MS` of typing. This
      // fires and does not await: the component is going away regardless,
      // and the request outlives it.
      if (enabledRef.current && dirtyRef.current) saveRef.current();
    };
  }, []);
};
