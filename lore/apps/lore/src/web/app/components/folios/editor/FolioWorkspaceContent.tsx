import type { EditorView } from "@codemirror/view";
import { useStore } from "alepha/react";
import { type ReactElement, useRef, useState } from "react";

import type { FolioResource } from "@/api/schemas/folioResourceSchema.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { useElementLinks } from "../../shared/element/useElementLinks.ts";
import {
  type MarkdownCommandId,
  markdownCommands,
} from "../../shared/markdown-editor/markdownCommands.ts";
import type { MarkdownEditorMode } from "../../shared/markdown-editor/MarkdownEditorInner.tsx";
import MarkdownModeToggle from "../../shared/markdown-editor/MarkdownModeToggle.tsx";
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
   * Folio ▸ New directory. Threaded from `FolioWorkspace.tsx` for the same
   * reason as `treeOpen`: the tree pane, and the model that opens a freshly
   * created directory into inline rename, mount one level up and outside
   * this component's per-folio `key`.
   */
  onCreateDirectory: () => void;
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

  // The element this workspace is showing. `LoreEditor` derives its own
  // links and upload target from it; the copy computed here exists only
  // because `useFolioFind` below needs `rendered` OUTSIDE the editor. Both
  // calls hit the same `useQuery` keys, so the lookups are fetched once.
  const element = {
    kind: "folio" as const,
    projectId: project?.id ?? 0,
    projectSlug: project?.slug ?? "",
    id: props.folio?.id,
  };
  const wikiLinks = useElementLinks(element, draft.values.content);

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
    createDirectory: props.onCreateDirectory,
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

  return (
    <div className="bg-background flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
            {/* No width cap and no padding here anymore: the summary field
                and the rule under it run edge to edge, and only the BODY is
                held to the prose measure. `FolioDocument` applies both per
                section — a single wrapper at this level cannot, since it
                would have to be two different widths at once. */}
            <div className="flex flex-col">
              <FolioDocument
                folio={props.folio}
                directoryId={props.directoryId}
                draft={draft}
                actions={actions}
                chromeSlot={props.chromeSlot}
                mode={mode}
                element={element}
                rendered={wikiLinks.rendered}
                imageUpload={!actions.actionState.isProtected}
                onEditorViewReady={(v) => {
                  editorViewRef.current = v;
                }}
              />
            </div>
          </div>

          {/* The view/edit toggle, floating over the document's top-right
              corner — all that survives of the deleted meta bar (feedback
              #62), and deliberately bigger than it was in that row, since it
              is now a lone control rather than the last chip of several.

              A SIBLING of the scroll container, exactly like the find bar
              below it and for the same reason: an `absolute` child of a
              scrolling box scrolls away with the text. `z-10` keeps it under
              the inspector's `z-20` drawer, which is meant to cover the
              document at narrow widths.

              Minimal, like the header's own icon buttons: no border, no
              filled surface, no shadow. It used to carry all three on the
              argument that a control hovering over prose needs to cover the
              text behind it — but the document is centred to a 68ch measure
              and this sits in the pane's right margin, so there is no prose
              under it to read through. The chrome was solving a problem
              that the reading measure had already removed, and a bordered
              chip in the corner reads as a floating widget rather than as
              part of the frame. The ghost variant's hover fill is enough to
              show it is hittable. */}
          <MarkdownModeToggle
            mode={mode}
            onChange={() => actions.handlers["view.mode"]()}
            disabled={actions.locked}
            iconOnly
            className="text-muted-foreground hover:text-foreground absolute top-3 right-3 z-10 size-9"
            iconClassName="size-4.5"
          />

          <FolioFindBar find={find} />
        </div>
        {!props.inspectorOpen && (
          <FolioInspectorRail onExpand={props.onToggleInspector} />
        )}
        {props.inspectorOpen && (
          // Below 1280px the inspector floats over the document instead of
          // taking a third column — at that width three columns leave the
          // text ~460px, too narrow to write in. `bg-background` matches the
          // document pane it covers; without it the drawer is transparent.
          <div
            className={
              props.inspectorDrawer
                ? "bg-background absolute top-0 right-0 bottom-0 z-20 flex shadow-lg"
                : "contents"
            }
          >
            <FolioInspector
              folio={props.folio}
              content={draft.values.content}
              tab={props.inspectorTab}
              onTabChange={props.onInspectorTabChange}
              onCollapse={props.onToggleInspector}
              onReverted={actions.applyReverted}
              contentElement={contentElement}
              protectedFolio={actions.actionState.isProtected}
              revisionsAt={draft.revisionsAt}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default FolioWorkspaceContent;
