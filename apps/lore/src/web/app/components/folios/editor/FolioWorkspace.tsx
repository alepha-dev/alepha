import { AlephaError } from "alepha";
import { type ReactElement, use } from "react";

import type { FolioResource } from "@/api/schemas/folioResourceSchema.ts";

import FolioWorkspaceContent from "./FolioWorkspaceContent.tsx";
import { FolioWorkspaceShellContext } from "./FolioWorkspaceShellContext.ts";

export interface FolioWorkspaceProps {
  /**
   * `undefined` for create mode, a folio for edit mode.
   *
   * `FolioResource` (the bare entity plus the loader-populated
   * `metadata`), not `Folio`, for the same reason `FolioLinksTab` uses
   * it: the route loader asks `getByShortId` for that metadata and parts
   * of the workspace read it. A bare `Folio` still satisfies the type
   * (`metadata` is optional), so create mode and the tests pass unchanged.
   */
  folio?: FolioResource;
  /**
   * Create-mode only: the directory the new folio lands in.
   */
  directoryId?: string;
}

/**
 * The folio workspace's document side: one always-editable surface, the
 * document and its inspector, rendered by `projectFoliosFolio` and by
 * `FolioCreatePage`.
 *
 * Everything that must outlive a folio switch (the tree, the pane state,
 * the inspector's active tab, the menubar slot) is NOT here: it is
 * `FolioWorkspaceShell`, mounted by `FoliosLayout`, and this component
 * reads it through `FolioWorkspaceShellContext`. See the shell's doc.
 *
 * There is no `key` on the content any more. It used to be keyed on the
 * folio id because the router reused a page across a param-only navigation,
 * so `useFolioDraft`'s `useForm` would have carried the previous folio's
 * buffer over. A page now remounts when its params change (#Q2349), and
 * `/folios/new` to `/folios/:shortId` is a different page, so every switch
 * of document already starts from a fresh `FolioWorkspaceContent`.
 */
const FolioWorkspace = (props: FolioWorkspaceProps): ReactElement => {
  const shell = use(FolioWorkspaceShellContext);
  if (!shell) {
    throw new AlephaError(
      "FolioWorkspace renders inside FolioWorkspaceShell, which FoliosLayout mounts",
    );
  }

  return (
    <FolioWorkspaceContent
      folio={props.folio}
      directoryId={props.directoryId}
      chromeSlot={shell.chromeSlot}
      inspectorOpen={shell.panes.inspectorOpen}
      inspectorDrawer={shell.panes.inspectorDrawer}
      onToggleInspector={shell.panes.toggleInspector}
      inspectorTab={shell.inspectorTab}
      onInspectorTabChange={shell.setInspectorTab}
      treeOpen={shell.panes.treeOpen}
      onToggleTree={shell.panes.toggleTree}
      onToggleFocus={shell.panes.toggleFocus}
      onCreateDirectory={() => shell.treeActions?.createDirectory()}
    />
  );
};

export default FolioWorkspace;
