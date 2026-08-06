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
}

/**
 * The workspace's actual content — draft buffer, `useFolioActions`, and the
 * document layout. Split out of `FolioWorkspace` so the latter can `key`
 * this whole subtree on the folio id (see the comment there); everything
 * stateful about editing ONE folio lives here so a remount is enough to
 * reset all of it.
 *
 * Save, pin, duplicate, export, encrypt/remove-protection and delete are
 * all owned by `useFolioActions` now — this component only renders the
 * chrome (status line, Save button) and the three-region layout
 * (tree / document / inspector), wiring the tree and inspector regions'
 * open state through to the hook so `view.tree` / `view.inspector` have
 * something to toggle even though those panes don't render anything yet
 * (Task 9, Task 10).
 */
const FolioWorkspaceContent = (
  props: FolioWorkspaceContentProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const [project] = useStore(currentProjectAtom);

  const draft = useFolioDraft(props.folio);

  // Real boolean state only for the two panes `useFolioActions`'s `panes`
  // input actually declares a boolean for (`tree`, `inspector`) — neither
  // pane renders anything yet (Task 9 / Task 10 own that), this just gives
  // `view.tree` / `view.inspector` a real toggle target now instead of a
  // second interface change later. `toggleFocus` / `find.show` have no
  // boolean in the input's declared shape — a later task owns their own
  // state (focus mode, the find-in-folio overlay), so those stay inert.
  const [treeOpen, setTreeOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const actions = useFolioActions({
    folio: props.folio,
    directoryId: props.directoryId,
    draft,
    panes: {
      tree: treeOpen,
      inspector: inspectorOpen,
      toggleTree: () => setTreeOpen((v) => !v),
      toggleInspector: () => setInspectorOpen((v) => !v),
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
    <div className="bg-card flex h-full min-h-0 flex-col overflow-hidden">
      {/* Chrome row — the menubar and toolbar mount here in Task 10,
          rendered through MDXEditor's `renderToolbar`. */}
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
        {/* Tree pane — Task 9 */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[812px] flex-col gap-4 px-8 py-8">
            <FolioDocument
              folio={props.folio}
              directoryId={props.directoryId}
              draft={draft}
              actions={actions}
              imageUploadHandler={imageUploadHandler}
            />
          </div>
        </div>
        {/* Inspector pane — Task 10 */}
      </div>
    </div>
  );
};

export default FolioWorkspaceContent;
