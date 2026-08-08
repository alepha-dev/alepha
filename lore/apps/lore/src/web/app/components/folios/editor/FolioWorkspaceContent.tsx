import { useStore } from "alepha/react";
import { type ReactElement, useState } from "react";
import type { Folio } from "@/api/entities/folios.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { useFolioImageUpload } from "../../shared/markdown-editor/useFolioImageUpload.ts";
import FolioDocument from "./document/FolioDocument.tsx";
import FolioFindBar from "./document/FolioFindBar.tsx";
import { useFolioFind } from "./document/useFolioFind.ts";
import FolioInspector, {
  type FolioInspectorTab,
} from "./inspector/FolioInspector.tsx";
import FolioInspectorRail from "./inspector/FolioInspectorRail.tsx";
import { useFolioActions } from "./useFolioActions.ts";
import { useFolioDraft } from "./useFolioDraft.ts";

export interface FolioWorkspaceContentProps {
  /**
   * `undefined` → create mode. A `Folio` → edit mode.
   */
  folio?: Folio;
  /**
   * Create-mode only: the directory the new folio lands in.
   */
  directoryId?: string;
  /**
   * The DOM node above the pane row that the menubar and toolbar portal
   * into. Owned by `FolioWorkspace` because the design puts both rows
   * above the tree as well as the document — see that file's comment for
   * why a portal, and not a plain move, is what gets them there.
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
 * + inspector regions. The status line and Save button no longer live here
 * either (Task 11): they moved into `FolioToolbar`, which mounts through
 * `MarkdownEditor`'s `renderToolbar` (see `FolioDocument.tsx`) alongside
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

  // Revision count for the meta bar — sourced from the inspector's
  // History tab (`onRevisionCount`), which fetches `listHistory` itself.
  const [revisionCount, setRevisionCount] = useState<number | undefined>(
    undefined,
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

  // Find-in-folio searches the RENDERED pane, which is why it is wired
  // here — `contentElement` above is the same DOM handle the Outline tab
  // scrolls headings within, and the only place the document's text nodes
  // are reachable from.
  const find = useFolioFind(contentElement, draft.values.content);

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
  });

  const imageUploadHandler = useFolioImageUpload(
    project?.id,
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
            <div className="mx-auto flex max-w-[812px] flex-col gap-4 px-8 py-8">
              <FolioDocument
                folio={props.folio}
                directoryId={props.directoryId}
                draft={draft}
                actions={actions}
                chromeSlot={props.chromeSlot}
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
              savedAt={draft.savedAt}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default FolioWorkspaceContent;
