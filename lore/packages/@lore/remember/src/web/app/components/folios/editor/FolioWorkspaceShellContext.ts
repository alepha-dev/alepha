import { createContext } from "react";

import type { FolioInspectorTab } from "./inspector/FolioInspector.tsx";
import type { FolioTreeActions } from "./tree/FolioTree.tsx";
import type { FolioPanesState } from "./useFolioPanes.ts";

/**
 * What the folio workspace's shell hands the document side it frames.
 */
export interface FolioWorkspaceShellValue {
  /**
   * The DOM node above the pane row that the menubar portals into.
   */
  chromeSlot: HTMLElement | null;
  panes: FolioPanesState;
  inspectorTab: FolioInspectorTab;
  setInspectorTab: (tab: FolioInspectorTab) => void;
  /**
   * Published by `FolioTree` once its model exists; `undefined` before.
   */
  treeActions?: FolioTreeActions;
}

// Context exemption: the value is scoped to one workspace subtree and
// crosses a `NestedView` boundary. `FolioWorkspaceShell` lives in the
// `/folios` layout so the tree and the pane state survive a folio-to-folio
// navigation, which remounts the page below it (#Q2349), and the document
// side rendered by that page reads the shell from here. It holds a DOM node
// and callbacks, which a schema-validated `$atom` cannot carry, and it is one
// value per mounted workspace, not per Alepha container.
export const FolioWorkspaceShellContext = createContext<
  FolioWorkspaceShellValue | undefined
>(undefined);
