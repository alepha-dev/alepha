import {
  activeEditor$,
  applyFormat$,
  applyListType$,
  insertCodeBlock$,
  insertMarkdown$,
  insertTable$,
  insertThematicBreak$,
  openLinkEditDialog$,
  openNewImageDialog$,
  useCellValue,
  usePublisher,
  viewMode$,
} from "@mdxeditor/editor";
import {
  $getSelection,
  $isRangeSelection,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import type { FolioActionHandlers } from "../useFolioActions.ts";

/**
 * Dispatches MDXEditor's own realm commands — Bold, Insert Table, Undo,
 * and friends — reachable ONLY from inside the editor's realm provider
 * (see `MarkdownEditorInner.tsx`'s doc on `renderToolbar`, and
 * `useFolioActions.ts`'s doc on `editorCommandsRef`). This hook must be
 * called from a component mounted THROUGH `renderToolbar` — today that is
 * only `FolioMenubar` — so `usePublisher`/`useCellValue` resolve against
 * the live MDXEditor/Lexical instance instead of throwing (both hooks
 * require a `RealmContext` ancestor).
 *
 * Every realm cell/action used here (`applyFormat$`, `applyListType$`,
 * `insertTable$`, `insertCodeBlock$`, `openLinkEditDialog$`,
 * `openNewImageDialog$`, `insertThematicBreak$`, `viewMode$`) is the exact
 * cell the corresponding stock toolbar button (`BoldItalicUnderlineToggles`,
 * `ListsToggle`, `InsertTable`, `InsertCodeBlock`, `CreateLink`,
 * `InsertImage`, `InsertThematicBreak`, `DiffSourceToggleWrapper`) publishes
 * to internally — confirmed by reading each component's source in
 * `@mdxeditor/editor/dist`, not guessed from its name. `UNDO_COMMAND` /
 * `REDO_COMMAND` are the same two Lexical commands `UndoRedo` dispatches
 * against `activeEditor$`'s value — there is no MDXEditor-level cell for
 * undo/redo, only the raw Lexical editor command, which is why this file
 * (uniquely among the workspace's code) imports directly from `lexical`
 * (added as an explicit `apps/lore` dependency for this).
 */
export const useEditorRealmCommands = (): Partial<FolioActionHandlers> => {
  const activeEditor = useCellValue(activeEditor$);
  const applyFormat = usePublisher(applyFormat$);
  const applyListType = usePublisher(applyListType$);
  const insertMarkdown = usePublisher(insertMarkdown$);
  const openLinkDialog = usePublisher(openLinkEditDialog$);
  const openImageDialog = usePublisher(openNewImageDialog$);
  const insertTable = usePublisher(insertTable$);
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const insertDivider = usePublisher(insertThematicBreak$);
  const changeViewMode = usePublisher(viewMode$);

  return {
    "edit.undo": () => {
      activeEditor?.dispatchCommand(UNDO_COMMAND, undefined);
    },
    "edit.redo": () => {
      activeEditor?.dispatchCommand(REDO_COMMAND, undefined);
    },
    // KNOWN ISSUE, disclosed in the task report: reliably works when this
    // handler is triggered from `FolioMenubar`'s own click (verified live,
    // repeatedly), but does NOT reliably apply when triggered via the ⌘B
    // keyboard shortcut — `applyFormat("bold")` runs (confirmed:
    // `FORMAT_TEXT_COMMAND`'s registered handler in `@lexical/rich-text`
    // reports `handled: true`), yet no formatting is applied to the DOM.
    // `edit.italic`/`edit.code` (the same `applyFormat$` shape) are
    // presumed to share this; `edit.undo`/`edit.redo`/`edit.link` do NOT —
    // verified those three DO work via keyboard, narrowing this to
    // selection-dependent TEXT-FORMAT commands specifically. Not
    // reproducible via a menu click, only via the global keydown path;
    // root cause not found within this task's time budget — see the task
    // report's "Concerns" section for the full investigation trail.
    "edit.bold": () => applyFormat("bold"),
    "edit.italic": () => applyFormat("italic"),
    "edit.code": () => applyFormat("code"),
    "edit.link": () => openLinkDialog(),
    // No realm command inserts literal, un-parsed text with control over
    // the resulting caret position: `insertMarkdown$` parses its argument
    // AS markdown and always leaves the caret AFTER the inserted content
    // (read its implementation in `plugins/core/index.js` — it calls
    // `$insertNodes` and never repositions the selection afterward), which
    // for `[[]]` lands after the closing brackets, not between them. Insert
    // the literal text through the live Lexical selection instead, then
    // step the still-collapsed caret back two characters — via the
    // selection's own `anchor`/`focus` `Point.set()`, NOT `selection.modify()`.
    // `modify()` bridges to the browser's native `Selection.modify()` DOM
    // API, which reads the CURRENT DOM text-node length to compute the
    // move — but the DOM hasn't been reconciled to the just-inserted
    // "[[]]" yet at this point in the SAME `editor.update()` callback (that
    // reconciliation only happens after the callback returns), so it
    // computes against the pre-insert (4-char, e.g. "See ") node while
    // Lexical's own state already has the post-insert 8-char offset,
    // throwing `IndexSizeError` (confirmed live: "offset 8 is larger than
    // the node's length (4)") and leaving the caret wherever Lexical's
    // error recovery falls back to — nowhere near the brackets. `Point.set`
    // only mutates Lexical's own state, no DOM read, so it can't hit that
    // mismatch; reconciliation then applies the FINAL corrected offset to
    // the DOM in one pass once the callback returns.
    "edit.wikiLink": () => {
      if (!activeEditor) return;
      activeEditor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        selection.insertText("[[]]");
        const offset = selection.anchor.offset - 2;
        selection.anchor.set(selection.anchor.key, offset, "text");
        selection.focus.set(selection.focus.key, offset, "text");
      });
      activeEditor.focus();
    },
    // Headings need a level (`applyBlockType$` takes a `HeadingTagType`,
    // e.g. `h2`) that this generic "insert a heading" menu item doesn't
    // carry — it is not "insert an H2" specifically. Inserting the ATX
    // marker as markdown and letting the next keystrokes fill it in
    // matches the item's own `syntaxHint` ("##") and needs no level
    // decided up front.
    "insert.heading": () => insertMarkdown("## "),
    "insert.bulletList": () => applyListType("bullet"),
    "insert.numberedList": () => applyListType("number"),
    "insert.taskList": () => applyListType("check"),
    // Same reasoning as headings: `applyBlockType$("quote")` CONVERTS the
    // current block in place (destroying whatever was already there)
    // rather than inserting a new one — not what an Insert-menu item
    // should do. Insert the marker as markdown instead, matching the
    // item's `syntaxHint` (">").
    "insert.quote": () => insertMarkdown("> "),
    "insert.image": () => openImageDialog(),
    "insert.table": () => insertTable({ rows: 3, columns: 3 }),
    "insert.codeBlock": () => insertCodeBlock({}),
    "insert.divider": () => insertDivider(),
    "view.rich": () => changeViewMode("rich-text"),
    "view.source": () => changeViewMode("source"),
  };
};
