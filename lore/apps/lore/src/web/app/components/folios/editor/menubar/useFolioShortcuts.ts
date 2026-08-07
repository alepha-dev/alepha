import { useEffect } from "react";
import type { FolioActionHandlers } from "../useFolioActions.ts";
import {
  type FolioActionId,
  type FolioActionState,
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
 * Bindings the editor ALREADY keeps the promise for on its own, with no
 * help from this hook needed or wanted — each one verified LIVE, not
 * assumed: temporarily disabled this hook's handling for the id alone and
 * confirmed the action still happens.
 *
 * - `edit.bold` / `edit.italic` / `edit.undo` / `edit.redo`: the browser
 *   translates the physical key combo into a native `beforeinput` event on
 *   any `contenteditable` (`inputType: "formatBold"` / `"formatItalic"` /
 *   `"historyUndo"` / `"historyRedo"`), and Lexical's own core
 *   `beforeinput` handler (`node_modules/lexical`, not MDXEditor, not us)
 *   switches on exactly these `inputType`s to dispatch its own
 *   `FORMAT_TEXT_COMMAND` / `UNDO_COMMAND` / `REDO_COMMAND`. Universal
 *   contenteditable behavior — nothing in this codebase registers it.
 * - `edit.link`: MDXEditor's own `linkDialogPlugin` registers a
 *   `KEY_DOWN_COMMAND` listener directly on the Lexical root editor
 *   (`@mdxeditor/editor/dist/plugins/link-dialog/index.js`) that matches
 *   `mod+k` itself and opens the link dialog — MDXEditor's code, not ours.
 *
 * Before this exclusion existed, this hook intercepted the keydown in the
 * CAPTURE phase (window, ahead of the contenteditable) and called
 * `preventDefault()` unconditionally on a match. That suppressed the
 * browser's native `beforeinput` translation before Lexical's core ever
 * saw it, so the editor's own handling never ran — and this hook's OWN
 * replacement dispatch (`editorCommandsRef`, called from outside the
 * update cycle the editor's native listener would have run inside)
 * reliably failed to see a selection to format. Net effect: pressing ⌘B
 * did nothing, even though `applyFormat("bold")` really ran and Lexical's
 * `FORMAT_TEXT_COMMAND` handler really reported `handled: true`. Bold via
 * the Edit menu was unaffected throughout — that path dispatches through
 * `useEditorRealmCommands` on a click, never touching this hook.
 *
 * `⌘B` (and the other four) are still true, kept promises — Task 4's
 * bindings don't change. They're just kept by the editor now, not by this
 * hook. **Do not delete this set to "simplify" the handler** — putting
 * these ids back under `preventDefault()` + dispatch silently reintroduces
 * the exact bug above.
 *
 * `edit.code` looks like it belongs here too but does NOT: there is no
 * native `formatCode`-style `beforeinput` translation for inline code, and
 * no plugin registers a `mod+e` handler either — confirmed live the same
 * way (disabling this hook's handling for it left `mod+e` doing nothing at
 * all). The same is true for every other realm-backed id in the model
 * (`insert.*`, `view.rich`/`view.source`) and for `edit.wikiLink` (no
 * keyboard convention for literal `[[` exists anywhere) — none of them
 * have a second party that already owns the key, so this hook is the only
 * thing that can ever fire them.
 *
 * Adding a new bound id to `FOLIO_MENUS` later? If the editor turns out to
 * already handle that key too, verify it the same way — disable this
 * hook's handling for that id alone and confirm the action still happens —
 * before adding it here. Don't guess from a component name or a plugin's
 * existence; `edit.link`'s own dialog plugin export is one thing, its
 * *keyboard* registration is a separate fact that has to be checked.
 */
const EDITOR_NATIVE_BINDINGS: ReadonlySet<FolioActionId> = new Set([
  "edit.bold",
  "edit.italic",
  "edit.undo",
  "edit.redo",
  "edit.link",
]);

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
 * Called once, from `FolioDocument` — a component that stays mounted for
 * the folio's whole session regardless of lock state (unlike `FolioMenubar`,
 * which only exists while unlocked — see `useFolioActions.ts`'s doc on
 * `editorCommandsRef` for why binding here, instead of inside the menubar
 * itself, is load-bearing and not just a style choice).
 */
export const useFolioShortcuts = (
  handlers: FolioActionHandlers,
  state: FolioActionState,
): void => {
  useEffect(() => {
    const bindings = folioShortcutBindings();

    const onKeyDown = (event: KeyboardEvent): void => {
      const id = bindings.get(normalize(event));
      if (!id) return;
      if (EDITOR_NATIVE_BINDINGS.has(id)) return;
      if (!isFolioActionEnabled(id, state)) return;
      event.preventDefault();
      handlers[id]();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [handlers, state]);
};
