import { useStore } from "alepha/react";
import { type ReactElement, useState } from "react";
import type { Folio } from "@/api/entities/folios.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import FolioWorkspaceContent from "./FolioWorkspaceContent.tsx";
import type { FolioInspectorTab } from "./inspector/FolioInspector.tsx";
import FolioTree from "./tree/FolioTree.tsx";
import FolioTreeResizer from "./tree/FolioTreeResizer.tsx";
import { useFolioFonts } from "./useFolioFonts.ts";
import { useFolioPanes } from "./useFolioPanes.ts";

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
 * Both pane booleans (and focus mode) come from `useFolioPanes`, which
 * also decides whether each pane is a column or an overlay drawer: below
 * 1024px the tree floats over the document, below 1280px the inspector
 * does. Only the WRAPPER's positioning changes at those breakpoints — the
 * tree itself keeps its single mount either way, for the reason above.
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
  const panes = useFolioPanes();
  const [inspectorTab, setInspectorTab] =
    useState<FolioInspectorTab>("outline");
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null);

  // Three states, not two: hidden, a column (`contents` — the wrapper
  // disappears and `FolioTree`'s own root becomes the flex child), or an
  // overlay drawer floating over the document on a viewport too narrow for
  // a third column. The tree stays MOUNTED through all three (see this
  // file's doc) — only its wrapper's positioning changes.
  const treeClassName = !panes.treeOpen
    ? "hidden"
    : panes.treeDrawer
      ? "bg-background absolute top-0 bottom-0 left-0 z-20 flex shadow-lg"
      : "contents";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The menubar and toolbar rows land HERE, portalled up from inside
          MDXEditor's realm (see `FolioDocument`'s `renderToolbar`). The
          design puts both rows above all three panes, spanning the whole
          surface — but every control on them (Bold, Block type, Undo) can
          only be published from inside that realm. A portal is what
          reconciles the two: it moves the DOM without leaving the React
          tree, so the rows keep their realm context while rendering here.
          A callback ref (via `useState`) rather than `useRef` so the
          document re-renders once the node exists and the portal has a
          target on the first paint after mount. */}
      <div ref={setChromeSlot} className="flex flex-none flex-col" />
      <div className="relative flex min-h-0 flex-1">
        {project && (
          <div className={treeClassName}>
            <FolioTree
              projectId={project.id}
              projectIdStr={String(project.id)}
              currentFolioId={props.folio?.id}
              width={panes.treeWidth}
            />
            {/* Inside the wrapper so the handle travels with the pane and
                disappears along with it. */}
            <FolioTreeResizer
              width={panes.treeWidth}
              onWidth={panes.setTreeWidth}
            />
          </div>
        )}
        <FolioWorkspaceContent
          key={props.folio?.id ?? "new"}
          folio={props.folio}
          directoryId={props.directoryId}
          chromeSlot={chromeSlot}
          inspectorOpen={panes.inspectorOpen}
          inspectorDrawer={panes.inspectorDrawer}
          onToggleInspector={panes.toggleInspector}
          inspectorTab={inspectorTab}
          onInspectorTabChange={setInspectorTab}
          treeOpen={panes.treeOpen}
          onToggleTree={panes.toggleTree}
          onToggleFocus={panes.toggleFocus}
        />
      </div>
    </div>
  );
};

export default FolioWorkspace;
