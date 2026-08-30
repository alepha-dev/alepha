import { useEffect } from "react";

import type { MarkdownEditorMode } from "../../../shared/markdown-editor/MarkdownEditorInner.tsx";
import type { FolioActionHandlers } from "../useFolioActions.ts";
import {
  type FolioActionState,
  editorOwnsBinding,
  folioShortcutBindings,
  isFolioActionEnabled,
} from "./folioMenubarModel.ts";

/**
 * Normalizes a `KeyboardEvent` into the model's binding grammar: lowercase,
 * `+`-joined, modifiers ordered `mod`, `shift`, `alt`. `mod` is ⌘ on macOS
 * and Ctrl elsewhere — `metaKey` and `ctrlKey` both collapse to the same
 * `mod` token so one binding string covers both platforms.
 */
const normalize = (event: KeyboardEvent): string => {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.shiftKey) parts.push("shift");
  if (event.altKey) parts.push("alt");
  parts.push(event.key.toLowerCase());
  return parts.join("+");
};

/**
 * Binds every OTHER `folioMenubarModel` keyboard shortcut on `window`, in
 * the CAPTURE phase — so e.g. ⌘S beats the browser's native Save-page
 * dialog, which only a capture-phase listener fires ahead of.
 *
 * Binds from `folioShortcutBindings()` (derived from `FOLIO_MENUS`), never
 * a second, hand-maintained list — that is the entire reason the model
 * exists: one source of truth for a label, its shortcut glyph, and the
 * binding string that has to keep matching it.
 *
 * A binding in `EDITOR_NATIVE_BINDINGS` (see its own doc) is skipped
 * entirely — no `preventDefault()`, no dispatch — so the editor's own
 * native handling gets the keydown untouched, exactly as it would for any
 * other contenteditable on the page.
 *
 * For everything else: `preventDefault()` fires ONLY when a binding
 * matched a currently-ENABLED action. A binding that doesn't match
 * anything is left alone, or every unhandled shortcut in the app would get
 * swallowed. A binding that matches a currently-DISABLED action
 * (`isFolioActionEnabled` returns false — e.g. ⌘S while the folio is
 * locked) is skipped entirely: no `preventDefault()`, no handler call, so
 * the browser's own behavior for that key combination still applies.
 *
 * Called from `FolioDocument` — a component that stays mounted for the
 * folio's whole session regardless of lock state, unlike `FolioMenubar`,
 * which only exists while unlocked. Binding here rather than inside the
 * menubar is what keeps the pane toggles (⌘\\, ⌘.) working on a locked
 * folio, where the menubar is not mounted at all.
 *
 * And from `FolioWorkspace`, for the empty `/folios` — where there is no
 * document, so no `FolioDocument` to bind them. That state still renders a
 * full `FolioMenubar` advertising ⌘\\ and ⌘. as enabled, and without this
 * second call the glyphs were a promise nothing kept. The two call sites
 * are mutually exclusive by construction (the workspace passes
 * `enabled: props.empty === true`, and the document only exists when
 * `empty` is false), so exactly one listener is bound at a time — two
 * would both `preventDefault()` and dispatch the same action twice.
 */
export const useFolioShortcuts = (
  handlers: FolioActionHandlers,
  state: FolioActionState,
  mode: MarkdownEditorMode,
  enabled = true,
): void => {
  useEffect(() => {
    if (!enabled) return;
    const bindings = folioShortcutBindings();

    const onKeyDown = (event: KeyboardEvent): void => {
      const id = bindings.get(normalize(event));
      if (!id) return;
      if (editorOwnsBinding(id, mode)) return;
      if (!isFolioActionEnabled(id, state)) return;
      event.preventDefault();
      void handlers[id]();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [handlers, state, mode, enabled]);
};
