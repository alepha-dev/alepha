import type { EditorView } from "@codemirror/view";
import { useStore } from "alepha/react";
import { type ReactElement, useRef, useState } from "react";
import type { FolioResource } from "@/api/schemas/folioResourceSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { MarkdownEditorMode } from "../../shared/markdown-editor/MarkdownEditorInner.tsx";
import {
  type MarkdownCommandId,
  markdownCommands,
} from "../../shared/markdown-editor/markdownCommands.ts";
import { useFolioImageUpload } from "../../shared/markdown-editor/useFolioImageUpload.ts";
import FolioDocument from "./document/FolioDocument.tsx";
import FolioFindBar from "./document/FolioFindBar.tsx";
import { useFolioFind } from "./document/useFolioFind.ts";
import FolioInspector, {
  type FolioInspectorTab,
} from "./inspector/FolioInspector.tsx";
import FolioInspectorRail from "./inspector/FolioInspectorRail.tsx";
import { useFolioActions } from "./useFolioActions.ts";
import { useFolioAutoSave } from "./useFolioAutoSave.ts";
import { useFolioDraft } from "./useFolioDraft.ts";
import { useFolioWikiLinks } from "./wikilink/useFolioWikiLinks.ts";

export interface FolioWorkspaceContentProps {
  /**
   * `undefined` → create mode. A folio → edit mode. `FolioResource`
   * rather than `Folio` — see `FolioWorkspaceProps`'s own doc.
   */
  folio?: FolioResource;
  /**
   * Create-mode only: the directory the new folio lands in.
   */
  directoryId?: string;
  /**
   * The DOM node above the pane row that the MENUBAR portals into. Owned
   * by `FolioWorkspace` because the design puts that row above the tree as
   * well as the document — see that file's comment for why a portal, and
   * not a plain move, is what gets it there.
   *
   * There is no second slot anymore: the formatting toolbar it used to
   * share this with was deleted with the editor realm that made those
   * commands possible.
   */
  chromeSlot: HTMLElement | null;
  /**
   * The inspector's open/closed state and active tab, threaded down from
   * `FolioWorkspace.tsx` — ABOVE the per-folio `key` that remounts this
   * component. See that file's doc for why: a boolean owned in here would
   * reset on every folio-to-folio navigation.
   */
  inspectorOpen: boolean;
  /**
   * `true` when the viewport is too narrow for the inspector to hold a
   * column of its own — it floats over the document instead. Derived in
   * `useFolioPanes`, threaded down alongside `inspectorOpen` because the
   * inspector renders here.
   */
  inspectorDrawer: boolean;
  onToggleInspector: () => void;
  inspectorTab: FolioInspectorTab;
  onInspectorTabChange: (tab: FolioInspectorTab) => void;
  /**
   * The tree pane's open/closed state, threaded from `FolioWorkspace.tsx`
   * for the same reason as the inspector's — see that file's doc. `view.tree`
   * (⌘\\) needs something to toggle; the tree pane itself does not live in
   * this component's subtree (it mounts one level up), only the boolean
   * driving its visibility passes through here, into `useFolioActions`'s
   * `panes.tree`.
   */
  treeOpen: boolean;
  onToggleTree: () => void;
  /**
   * Focus mode (⌘.) — hides both side panes and restores them on a second
   * press. Owned by `useFolioPanes` one level up, like every other pane
   * command, because it moves the tree as well as the inspector.
   */
  onToggleFocus: () => void;
}

/**
 * The workspace's actual content — draft buffer, `useFolioActions`, and the
 * document layout. Split out of `FolioWorkspace` so the latter can `key`
 * this whole subtree on the folio id (see the comment there); everything
 * stateful about editing ONE folio lives here so a remount is enough to
 * reset all of it.
 *
 * Save, pin, duplicate, export, encrypt/remove-protection and delete are
 * all owned by `useFolioActions` now — this component renders the document
 * + inspector regions. The status line and Save button live in
 * `FolioMenubar`. The folio TREE pane (Task 9) is NOT one of these regions
 * — it mounts in `FolioWorkspace.tsx`, outside this component's `key`,
 * because its collapse state must survive a folio-to-folio navigation and
 * everything in this component is deliberately torn down by one. Both
 * `treeOpen` and `inspectorOpen` are props from `FolioWorkspace.tsx` for
 * that same reason — see `FolioWorkspaceContentProps`'s doc.
 */
const FolioWorkspaceContent = (
  props: FolioWorkspaceContentProps,
): ReactElement => {
  const [project] = useStore(currentProjectAtom);

  const draft = useFolioDraft(props.folio);

  // Opens the inspector (if closed) and switches it to the History tab —
  // backs `history.revisions` (⌘Y). Both `inspectorOpen` and
  // `inspectorTab` are props from `FolioWorkspace.tsx` (see
  // `FolioWorkspaceContentProps`'s doc), so this just composes the two
  // setters already threaded down; it owns no state of its own.
  const openHistory = (): void => {
    if (!props.inspectorOpen) props.onToggleInspector();
    props.onInspectorTabChange("history");
  };

  // Revision count for the meta bar. Seeded from the folio's own
  // `metadata.revisionCount`, which the route loader asked `getByShortId`
  // for in the same call that fetched the folio — the History tab used to
  // be the only source, and paying a `listHistory` round-trip on every
  // folio open to render one number in the meta bar is what that cost.
  // The tab still reports through `onRevisionCount` once it has actually
  // fetched (a revert or a pin toggle moves the number), and it overrides
  // this seed when it does.
  //
  // The initializer runs once per mount, which is once per folio: this
  // whole component is keyed on the folio id in `FolioWorkspace`.
  const [revisionCount, setRevisionCount] = useState<number | undefined>(
    () => props.folio?.metadata?.revisionCount,
  );

  // The document pane's DOM container, threaded to the inspector's
  // Outline tab so it can resolve a heading entry to the real `<h1…h6>`
  // element to scroll to. A callback ref (via `useState`) rather than a
  // plain `useRef` so the inspector re-renders once it's actually
  // available — a plain ref's first assignment wouldn't otherwise trigger
  // a re-render, and the Outline tab would stay stuck with `null` until
  // something else happened to re-render this component.
  const [contentElement, setContentElement] = useState<HTMLElement | null>(
    null,
  );

  // View or raw markdown. Held here, not in `FolioDocument`, because
  // `useFolioActions` below needs a toggle for the `view.mode` id (⌘E) and
  // this is where that hook is called.
  //
  // A folio WITH content opens in `"view"` — it is project memory, read far
  // more often than written. An empty one opens in `"edit"`.
  //
  // The condition is the content, not the route. Create mode is the obvious
  // empty case, but not the only one: the tree's "New folio" button creates
  // a real, empty folio through the API and navigates to it, so it arrives
  // here WITH a `props.folio` and would have opened in View mode showing a
  // blank pane — nothing to read, and no visible hint that the toggle is
  // what stands between the author and typing.
  //
  // The initializer runs once per mount, which is once per folio (this
  // component is keyed on the folio id in `FolioWorkspace`), so saving a new
  // folio does not yank the author out of Edit mode mid-sentence.
  const [mode, setMode] = useState<MarkdownEditorMode>(
    props.folio?.content?.trim() ? "view" : "edit",
  );

  // Both halves of wiki-link support: the `[[` picker's entries and the
  // rewritten markdown View mode renders. Hoisted to this component rather
  // than living in `FolioDocument` because `useFolioFind` below has to key
  // on `rendered`, not on the raw draft — see there.
  // The live CodeMirror view, handed up by `CodeMirrorEditor` on mount and
  // nulled on unmount. The menubar's formatting actions and the selection
  // popup both dispatch into it.
  const editorViewRef = useRef<EditorView | null>(null);

  const wikiLinks = useFolioWikiLinks(
    project?.id,
    project?.slug,
    draft.values.content,
  );

  // Find-in-folio searches the RENDERED pane, which is why it is wired
  // here — `contentElement` above is the same DOM handle the Outline tab
  // scrolls headings within, and the only place the document's text nodes
  // are reachable from.
  //
  // ⚠️ Keyed on `wikiLinks.rendered`, NOT on `draft.values.content`. The
  // two differ, and the difference arrives LATE: `rendered` depends on the
  // project's quest list, which is fetched, so it changes once that request
  // resolves even though the raw markdown never did. MarkdownView then
  // replaces the pane's text nodes and every range this hook is holding
  // points at detached DOM — the match count silently drops to zero
  // mid-search. Keying on the raw content made that a race that passed or
  // failed on fetch timing.
  const find = useFolioFind(contentElement, wikiLinks.rendered);

  const actions = useFolioActions({
    folio: props.folio,
    directoryId: props.directoryId,
    draft,
    panes: {
      tree: props.treeOpen,
      inspector: props.inspectorOpen,
      toggleTree: props.onToggleTree,
      toggleInspector: props.onToggleInspector,
      toggleFocus: props.onToggleFocus,
      openHistory,
    },
    find: { show: find.show },
    mode: {
      editing: mode === "edit",
      toggle: () =>
        setMode((current) => (current === "view" ? "edit" : "view")),
    },
    format: {
      run: (id) => {
        const view = editorViewRef.current;
        // Inert with no view — the menubar already disables these in View
        // mode, so this is the belt to that braces.
        if (!view) return;
        markdownCommands[id as MarkdownCommandId]?.(view);
      },
    },
  });

  // Auto-save. Disabled in create mode (a folio should not spring into
  // existence on the first keystroke) and while a protected folio is
  // locked (the draft is ciphertext this session cannot re-encrypt).
  useFolioAutoSave({
    enabled: !!props.folio && !actions.locked,
    dirty: draft.dirty,
    values: draft.values,
    saving: actions.saving,
    save: () => actions.handlers["folio.save"](),
  });

  const imageUploadHandler = useFolioImageUpload(
    project?.id,
    props.folio?.id,
    !actions.actionState.isProtected,
  );

  return (
    <div className="bg-card flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* `relative` is the containing block for the inspector's drawer
          form below — without it the drawer would position itself against
          the viewport instead of the pane row. */}
      <div className="relative flex min-h-0 flex-1">
        {/* The tree pane (Task 9) mounts one level up, in
            `FolioWorkspace.tsx` — not here. See that file's doc for why. */}
        {/* The find bar is a sibling of the scroll container, not a child
            of it: an `absolute` element inside a scrolling box scrolls away
            with the text it is searching. */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div
            ref={setContentElement}
            className="min-w-0 flex-1 overflow-y-auto"
          >
            {/* No width cap and no padding here anymore: the header row and
                the rule under it run edge to edge, and only the BODY is held
                to the prose measure. `FolioDocument` applies both per section
                — a single wrapper at this level cannot, since it would have
                to be two different widths at once. */}
            <div className="flex flex-col">
              <FolioDocument
                folio={props.folio}
                directoryId={props.directoryId}
                draft={draft}
                actions={actions}
                chromeSlot={props.chromeSlot}
                mode={mode}
                wikiLinks={wikiLinks}
                onEditorViewReady={(v) => {
                  editorViewRef.current = v;
                }}
                revisionCount={revisionCount}
                imageUploadHandler={imageUploadHandler}
              />
            </div>
          </div>
          <FolioFindBar find={find} />
        </div>
        {!props.inspectorOpen && (
          <FolioInspectorRail onExpand={props.onToggleInspector} />
        )}
        {props.inspectorOpen && (
          // Below 1280px the inspector floats over the document instead of
          // taking a third column — at that width three columns leave the
          // text ~460px, too narrow to write in. `bg-card` matches the
          // document pane it covers; without it the drawer is transparent.
          <div
            className={
              props.inspectorDrawer
                ? "bg-card absolute top-0 right-0 bottom-0 z-20 flex shadow-lg"
                : "contents"
            }
          >
            <FolioInspector
              folio={props.folio}
              content={draft.values.content}
              tab={props.inspectorTab}
              onTabChange={props.onInspectorTabChange}
              onCollapse={props.onToggleInspector}
              onRevisionCount={setRevisionCount}
              onReverted={actions.applyReverted}
              contentElement={contentElement}
              protectedFolio={actions.actionState.isProtected}
              savedAt={draft.savedAt}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default FolioWorkspaceContent;
