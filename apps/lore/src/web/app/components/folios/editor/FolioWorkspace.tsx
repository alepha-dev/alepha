import { useStore } from "alepha/react";
import { type ReactElement, useState } from "react";
import type { Folio } from "@/api/entities/folios.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import FolioWorkspaceContent from "./FolioWorkspaceContent.tsx";
import type { FolioInspectorTab } from "./inspector/FolioInspector.tsx";
import FolioTree from "./tree/FolioTree.tsx";
import { useFolioFonts } from "./useFolioFonts.ts";

export interface FolioWorkspaceProps {
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
 * The folio workspace — one always-editable surface replacing the old
 * split between a read-only `FolioView` and a separate editor form
 * (`FolioEditor`, mounted at the now-deleted `/edit` route).
 *
 * Three panes: folio tree, document, inspector. The tree (Task 9) is
 * mounted directly here, alongside the keyed content below — NOT inside
 * it. That placement is load-bearing, not a style choice: the tree's
 * collapse state and its one-time default-collapse seed (see
 * `useFolioTreeModel`'s file doc) only behave correctly if the tree
 * SURVIVES a folio-to-folio navigation, the exact opposite of what the
 * `key` below deliberately does to the content pane. The deleted
 * `FolioTreePanel.tsx` got this "for free" in the old split-view world
 * because it was mounted by `FolioView.tsx`, itself never remounted
 * across folio navigations for the same router reason explained below —
 * mounting the tree inside the keyed subtree here would silently
 * reintroduce feedback #14 (every navigation re-collapsing directories the
 * user had opened).
 *
 * The inspector's OPEN/CLOSED state and active tab live here too, for the
 * same reason: `FolioInspector` itself mounts inside the keyed
 * `FolioWorkspaceContent` (unlike the tree, it needs the live draft
 * content and `useFolioActions`'s revert sync, both of which only exist
 * in that keyed subtree) — but a plain `useState` living INSIDE that
 * subtree would reset to its default (default tab, always open) on every
 * folio-to-folio navigation, which is exactly the class of bug Task 9's
 * report flagged for the tree's own collapse state. Threading the state
 * down as props keeps "which tab is active" and "is the pane open"
 * durable across navigation while the component that actually RENDERS
 * the tabs still lives where its data does.
 *
 * The tree pane's OPEN/CLOSED state (`view.tree`, ⌘\\) lives here too, for
 * the same "must survive the keyed child's remount" reason as the
 * inspector's — and for a second reason specific to the tree: it must also
 * survive being toggled off and back on within the SAME folio, which is
 * why the tree stays mounted (via a `hidden` class) rather than being
 * conditionally rendered — unmounting it would drop `useFolioTreeModel`'s
 * collapse state and re-run its one-time seed/fallback fetch every time
 * the pane is reopened.
 *
 * The document + inspector content lives in a child keyed on the folio id.
 * Alepha's router does not remount a page component on a param-only
 * navigation (`ReactPageProvider.createElement` passes no `key`, and
 * `NestedView` renders the resolved element as plain state) — clicking
 * from one folio to another under this same route only re-renders
 * `FolioWorkspace` with new props, it does not tear it down. Without the
 * `key` below, `useFolioDraft`'s `useForm` (whose `FormModel` is cached
 * for the life of its calling component) and its
 * `useFormValues`/`useFormState` subscribers (which bind to that one
 * model once, at mount) would carry the previous folio's buffer over for
 * a frame, and the form's own `id` would never actually change. Keying on
 * the folio id turns a folio switch into a full remount instead, which is
 * the only way to reset all of that state atomically — and, by staying
 * OUTSIDE that key, is exactly what the tree pane must avoid.
 */
const FolioWorkspace = (props: FolioWorkspaceProps): ReactElement => {
  useFolioFonts();
  const [project] = useStore(currentProjectAtom);
  const [treeOpen, setTreeOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] =
    useState<FolioInspectorTab>("outline");

  return (
    <div className="flex h-full min-h-0">
      {project && (
        <div className={treeOpen ? "contents" : "hidden"}>
          <FolioTree
            projectId={project.id}
            projectIdStr={String(project.id)}
            currentFolioId={props.folio?.id}
          />
        </div>
      )}
      <FolioWorkspaceContent
        key={props.folio?.id ?? "new"}
        folio={props.folio}
        directoryId={props.directoryId}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        inspectorTab={inspectorTab}
        onInspectorTabChange={setInspectorTab}
        treeOpen={treeOpen}
        onToggleTree={() => setTreeOpen((v) => !v)}
      />
    </div>
  );
};

export default FolioWorkspace;
