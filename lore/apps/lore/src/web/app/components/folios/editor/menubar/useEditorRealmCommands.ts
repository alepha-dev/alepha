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
    // `edit.undo`/`edit.redo`/`edit.bold`/`edit.italic`/`edit.link` below
    // back the Edit MENU's click path only — `useFolioShortcuts.ts`'s
    // `EDITOR_NATIVE_BINDINGS` deliberately excludes these five from the
    // ⌘-keyboard path, because the browser/Lexical/MDXEditor already
    // handle them natively there and this hook's own dispatch actively
    // broke that native handling when it intercepted the keydown first
    // (see that file's doc for the full story). A menu click never goes
    // through a keydown at all, so it was never affected and still uses
    // this exact code.
    "edit.undo": () => {
      activeEditor?.dispatchCommand(UNDO_COMMAND, undefined);
    },
    "edit.redo": () => {
      activeEditor?.dispatchCommand(REDO_COMMAND, undefined);
    },
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
    // Headings need a level that this generic "insert a heading" menu item
    // doesn't carry — it is not "insert an H2" specifically. Inserting the ATX
    // marker as markdown and letting the next keystrokes fill it in matches
    // the item's own `syntaxHint` ("##") and needs no level decided up front.
    //
    // This comment used to justify itself against `applyBlockType$`. That
    // signal has no subscriber in MDXEditor and does nothing at all, so it was
    // never the alternative being weighed — see FolioToolbar. The conversion
    // primitive that does work is `convertSelectionToNode$`, and the reasoning
    // above holds against it unchanged.
    "insert.heading": () => insertMarkdown("## "),
    "insert.bulletList": () => applyListType("bullet"),
    "insert.numberedList": () => applyListType("number"),
    "insert.taskList": () => applyListType("check"),
    // Same reasoning as headings: converting the current block in place
    // (`convertSelectionToNode$` with `$createQuoteNode`, which is what the
    // toolbar's block-type Select does) would destroy whatever was already
    // there rather than insert a new block — not what an Insert-menu item
    // should do. Insert the marker as markdown instead, matching the item's
    // `syntaxHint` (">").
    "insert.quote": () => insertMarkdown("> "),
    "insert.image": () => openImageDialog(),
    "insert.table": () => insertTable({ rows: 3, columns: 3 }),
    "insert.codeBlock": () => insertCodeBlock({}),
    "insert.divider": () => insertDivider(),
    "view.rich": () => changeViewMode("rich-text"),
    "view.source": () => changeViewMode("source"),
  };
};
