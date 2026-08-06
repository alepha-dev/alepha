import { Button } from "@alepha/ui/components/ui/button";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Save } from "lucide-react";
import { type ReactElement, useState } from "react";
import type { Folio } from "@/api/entities/folios.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
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
}

/**
 * The workspace's actual content — draft buffer, `useFolioActions`, and the
 * document layout. Split out of `FolioWorkspace` so the latter can `key`
 * this whole subtree on the folio id (see the comment there); everything
 * stateful about editing ONE folio lives here so a remount is enough to
 * reset all of it.
 *
 * Save, pin, duplicate, export, encrypt/remove-protection and delete are
 * all owned by `useFolioActions` now — this component renders the chrome
 * (status line, Save button) and the document + inspector regions. The
 * folio TREE pane (Task 9) is NOT one of these regions — it mounts in
 * `FolioWorkspace.tsx`, outside this component's `key`, because its
 * collapse state must survive a folio-to-folio navigation and everything
 * in this component is deliberately torn down by one. This component still
 * wires the inspector region's open state through to `useFolioActions` so
 * `view.tree` / `view.inspector` have something to toggle even though
 * `view.tree` currently has no visible effect on the tree it no longer
 * shares a subtree with (Task 10/11 concern — see the task report).
 * `view.inspector` DOES now have a visible effect: the inspector's
 * open/closed state is a prop from `FolioWorkspace.tsx`, not local state
 * — see `FolioWorkspaceContentProps`'s doc.
 */
const FolioWorkspaceContent = (
  props: FolioWorkspaceContentProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const [project] = useStore(currentProjectAtom);

  const draft = useFolioDraft(props.folio);

  // Real boolean state only for the pane `useFolioActions`'s `panes`
  // input declares a boolean for that this component still owns —
  // `tree`. `inspector` now comes from `props` (see
  // `FolioWorkspaceContentProps`'s doc: it has to live above this
  // component's `key` or a folio switch would silently reset it).
  // `toggleFocus` / `find.show` have no boolean in the input's declared
  // shape — a later task owns their own state (focus mode, the
  // find-in-folio overlay), so those stay inert.
  const [treeOpen, setTreeOpen] = useState(true);

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
      tree: treeOpen,
      inspector: props.inspectorOpen,
      toggleTree: () => setTreeOpen((v) => !v),
      toggleInspector: props.onToggleInspector,
      toggleFocus: () => {},
    },
    find: { show: () => {} },
  });

  const imageUploadHandler = useFolioImageUpload(
    project?.id,
    !actions.actionState.isProtected,
  );

  const statusLabel =
    draft.statusKey === "saved" && draft.savedAt
      ? tr("folios.editor.status.saved", {
          args: [String(dt.of(draft.savedAt).fromNow())],
        })
      : tr(`folios.editor.status.${draft.statusKey}`);

  return (
    <div className="bg-card flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Chrome row — the menubar and toolbar mount here in a later task,
          rendered through MDXEditor's `renderToolbar`. (This comment
          previously said "Task 10" — Task 10 turned out to be the
          inspector pane instead; corrected so it doesn't mislead
          whichever task actually builds the menubar.) */}
      <div className="border-border flex h-13 flex-none items-center gap-2 border-b px-3">
        <div className="flex-1" />
        <span className="text-muted-foreground folio-mono text-xs">
          {statusLabel}
        </span>
        <Button
          size="sm"
          onClick={() => actions.handlers["folio.save"]()}
          disabled={actions.saving || actions.locked}
        >
          <Save className="size-4" />
          {tr("folios.editor.action.save")}
        </Button>
      </div>

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
