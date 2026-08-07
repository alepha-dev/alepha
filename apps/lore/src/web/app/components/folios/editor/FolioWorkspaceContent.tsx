import { useStore } from "alepha/react";
import { type ReactElement, useState } from "react";
import type { Folio } from "@/api/entities/folios.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { useFolioImageUpload } from "../../shared/markdown-editor/useFolioImageUpload.ts";
import FolioDocument from "./document/FolioDocument.tsx";
import FolioInspector, {
  type FolioInspectorTab,
} from "./inspector/FolioInspector.tsx";
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
   * The inspector's open/closed state and active tab, threaded down from
   * `FolioWorkspace.tsx` — ABOVE the per-folio `key` that remounts this
   * component. See that file's doc for why: a boolean owned in here would
   * reset on every folio-to-folio navigation.
   */
  inspectorOpen: boolean;
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

  const actions = useFolioActions({
    folio: props.folio,
    directoryId: props.directoryId,
    draft,
    panes: {
      tree: props.treeOpen,
      inspector: props.inspectorOpen,
      toggleTree: props.onToggleTree,
      toggleInspector: props.onToggleInspector,
      toggleFocus: () => {},
      openHistory,
    },
    find: { show: () => {} },
  });

  const imageUploadHandler = useFolioImageUpload(
    project?.id,
    !actions.actionState.isProtected,
  );

  return (
    <div className="bg-card flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        {/* The tree pane (Task 9) mounts one level up, in
            `FolioWorkspace.tsx` — not here. See that file's doc for why. */}
        <div ref={setContentElement} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[812px] flex-col gap-4 px-8 py-8">
            <FolioDocument
              folio={props.folio}
              directoryId={props.directoryId}
              draft={draft}
              actions={actions}
              revisionCount={revisionCount}
              imageUploadHandler={imageUploadHandler}
            />
          </div>
        </div>
        {props.inspectorOpen && (
          <FolioInspector
            folio={props.folio}
            content={draft.values.content}
            tab={props.inspectorTab}
            onTabChange={props.onInspectorTabChange}
            onRevisionCount={setRevisionCount}
            onReverted={actions.applyReverted}
            contentElement={contentElement}
            savedAt={draft.savedAt}
          />
        )}
      </div>
    </div>
  );
};

export default FolioWorkspaceContent;
