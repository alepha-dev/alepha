import { TreeViewResizer } from "@alepha/ui/tree";
import { useStore } from "alepha/react";
import { useRouter, useRouterState } from "alepha/react/router";
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { preloadMarkdownEditor } from "../../shared/markdown-editor/MarkdownEditor.tsx";
import {
  FolioWorkspaceShellContext,
  type FolioWorkspaceShellValue,
} from "./FolioWorkspaceShellContext.ts";
import type { FolioInspectorTab } from "./inspector/FolioInspector.tsx";
import FolioTree, { type FolioTreeActions } from "./tree/FolioTree.tsx";
import FolioTreeRail from "./tree/FolioTreeRail.tsx";
import {
  TREE_DEFAULT_WIDTH,
  TREE_MAX_WIDTH,
  TREE_MIN_WIDTH,
  useFolioPanes,
} from "./useFolioPanes.ts";

export interface FolioWorkspaceShellProps {
  /**
   * The folio the document side is showing, for the tree's highlight.
   * Absent on `/folios` and on the create page.
   */
  currentFolioId?: string;
  /**
   * The document side: the empty state, or the page `NestedView` renders.
   */
  children: ReactNode;
}

/**
 * The folio workspace's frame: the menubar row, the folio tree and its rail,
 * and the pane state the document side reads (tree and inspector open,
 * focus mode, the inspector's active tab).
 *
 * ## ⚠️ It lives in the `/folios` LAYOUT, and that is the whole design
 *
 * A page remounts when its params change (#Q2349): `/folios/12` to
 * `/folios/13` tears down the `projectFoliosFolio` page and builds a new one.
 * Everything that must outlive a folio switch therefore sits here, in
 * `FoliosLayout`, which has no param and is never remounted inside `/folios`:
 *
 * - the tree, with its scroll position, its inline rename and its one-time
 *   seed (collapse also survives leaving `/folios`, through
 *   `folioTreeCollapsedAtom`);
 * - the inspector's active tab, and focus mode, which is a plain `useState`
 *   in `useFolioPanes`;
 * - the menubar slot the document portals into.
 *
 * Before #Q2349 this state sat in the page and survived only because the
 * router did not remount on a param change, while `/folios` to a folio and
 * `/folios/new` to the new folio each crossed a component boundary and lost
 * it. Hoisted, those two survive as well, which retired the atom that used
 * to carry a just-created folio's inline rename across the second one.
 *
 * The document side reads the shell through `FolioWorkspaceShellContext`:
 * it is rendered by a child page on the other side of a `NestedView`, so
 * props cannot reach it.
 *
 * The tree stays MOUNTED while its pane is hidden (a `hidden` class, not a
 * conditional): unmounting it would drop its state and re-run its fallback
 * fetch every time the pane is reopened. `useFolioPanes` decides whether each
 * pane is a column or an overlay drawer (below 1024px the tree floats over the
 * document, below 1280px the inspector does); only the wrapper's positioning
 * changes at those breakpoints.
 */
const FolioWorkspaceShell = (props: FolioWorkspaceShellProps): ReactElement => {
  const [project] = useStore(currentProjectAtom);
  const router = useRouter<AppRouter>();
  const panes = useFolioPanes();
  const [inspectorTab, setInspectorTab] =
    useState<FolioInspectorTab>("outline");
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null);
  // Published by `FolioTree` once its model exists. `undefined` for the one
  // frame before that effect runs, and whenever the project has not loaded.
  const [treeActions, setTreeActions] = useState<FolioTreeActions>();

  // `/folios?dir=<shortId>` - the breadcrumb's directory segments and the
  // tree's own Open / Open in new tab both build that link.
  //
  // Read off the URL here rather than resolved in the route loader: the tree
  // already holds the directory list the shortId resolves against, so a
  // loader round-trip would buy nothing, and this way the parameter also
  // works on a navigation that does not re-run the loader.
  useRouterState();
  const dirParam = Number.parseInt(String(router.query.dir ?? ""), 10);
  const revealDirectoryShortId = Number.isFinite(dirParam)
    ? dirParam
    : undefined;

  // Start fetching the editor chunk as soon as the workspace mounts, rather
  // than when something first renders the editor. It matters most on the
  // empty `/folios`, where the next click is almost certainly a folio.
  useEffect(() => {
    preloadMarkdownEditor();
  }, []);

  const shell = useMemo<FolioWorkspaceShellValue>(
    () => ({ chromeSlot, panes, inspectorTab, setInspectorTab, treeActions }),
    [chromeSlot, panes, inspectorTab, treeActions],
  );

  // Three states, not two: hidden, a column (`contents`: the wrapper
  // disappears and `FolioTree`'s own root becomes the flex child), or an
  // overlay drawer floating over the document on a viewport too narrow for a
  // third column. The tree stays MOUNTED through all three.
  const treeClassName = !panes.treeOpen
    ? "hidden"
    : panes.treeDrawer
      ? "bg-background absolute top-0 bottom-0 left-0 z-20 flex shadow-lg"
      : "contents";

  return (
    <FolioWorkspaceShellContext value={shell}>
      {/* `min-w-0 flex-1` is not decoration. `FoliosLayout` puts this inside
          a ROW flex container, where a flex item defaults to `flex: 0 1 auto`
          (sized to its content, never stretched). Without it the workspace
          ended ~260px short of the content area's right edge at a wide
          viewport. `min-w-0` then lets it shrink below its content's
          intrinsic width instead of overflowing. */}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {/* The MENUBAR row lands HERE, portalled up from the document side,
            because the design puts it above all three panes while the
            component that owns its state lives in the document column.

            A callback ref (via `useState`) rather than `useRef` so the
            document re-renders once the node exists and the portal has a
            target on the first paint after mount. */}
        <div ref={setChromeSlot} className="flex flex-none flex-col" />
        <div className="relative flex min-h-0 flex-1">
          {/* ⚠️ Only where the tree would otherwise be a COLUMN. Below
              `TREE_DRAWER_BELOW` the pane is an overlay that defaults closed,
              so a rail there would put a permanent strip on every narrow
              viewport for a pane nobody collapsed. */}
          {!panes.treeOpen && !panes.treeDrawer && (
            <FolioTreeRail onExpand={panes.toggleTree} />
          )}
          {project && (
            <div className={treeClassName}>
              <FolioTree
                projectId={project.id}
                projectSlug={project.slug}
                currentFolioId={props.currentFolioId}
                revealDirectoryShortId={revealDirectoryShortId}
                width={panes.treeWidth}
                onCollapse={panes.toggleTree}
                onActions={setTreeActions}
              />
              {/* Inside the wrapper so the handle travels with the pane and
                  disappears along with it. */}
              <TreeViewResizer
                width={panes.treeWidth}
                onWidth={panes.setTreeWidth}
                minWidth={TREE_MIN_WIDTH}
                maxWidth={TREE_MAX_WIDTH}
                defaultWidth={TREE_DEFAULT_WIDTH}
              />
            </div>
          )}
          {props.children}
        </div>
      </div>
    </FolioWorkspaceShellContext>
  );
};

export default FolioWorkspaceShell;
