import { AlephaError } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { type ReactElement, use, useMemo } from "react";
import { createPortal } from "react-dom";

import type { FolioController } from "@/api/controllers/FolioController.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import FolioEmptyState from "./document/FolioEmptyState.tsx";
import { FolioWorkspaceShellContext } from "./FolioWorkspaceShellContext.ts";
import FolioMenubar from "./menubar/FolioMenubar.tsx";
import {
  type FolioActionState,
  folioMenuItems,
} from "./menubar/folioMenubarModel.ts";
import { useFolioShortcuts } from "./menubar/useFolioShortcuts.ts";
import type { FolioActionHandlers } from "./useFolioActions.ts";

export interface FolioWorkspaceEmptyProps {}

/**
 * No document, so nothing can be new, locked, protected or pinned: the only
 * flag that means anything here is `noFolio`, and it is the one
 * `isFolioActionEnabled` checks first.
 */
const EMPTY_STATE_ACTION_STATE: FolioActionState = {
  noFolio: true,
  locked: false,
  isNew: false,
  dirty: false,
  isProtected: false,
  isPinned: false,
};

/**
 * The document side of `/folios` itself: the tree is open in the shell,
 * nothing is chosen, so there is no editor, only where to go next.
 *
 * Distinct from create mode, which has an empty but real document to type
 * into. It renders inside `FolioWorkspaceShell`, from `FoliosLayout`.
 */
const FolioWorkspaceEmpty = (
  _props: FolioWorkspaceEmptyProps,
): ReactElement => {
  const shell = use(FolioWorkspaceShellContext);
  if (!shell) {
    throw new AlephaError(
      "FolioWorkspaceEmpty renders inside FolioWorkspaceShell, which FoliosLayout mounts",
    );
  }
  const [project] = useStore(currentProjectAtom);
  const folioApi = useClient<FolioController>();
  const router = useRouter<AppRouter>();
  const treeActions = shell.treeActions;
  const panes = shell.panes;

  // There is no `useFolioActions` here: that hook needs a draft, and there is
  // no document. Only the ids `availableWithoutFolio` marks can fire; the rest
  // are rendered disabled, so their no-op is never reachable and exists only
  // to satisfy the exhaustive handler map.
  const handlers = useMemo<FolioActionHandlers>(() => {
    const noop = (): void => {};
    const map = {} as FolioActionHandlers;
    for (const item of folioMenuItems()) {
      map[item.id] = noop;
    }
    map["folio.new"] = () => {
      if (treeActions) return treeActions.createFolio();
      // Before the tree publishes, fall back to the create route, the same
      // destination `useFolioActions` uses.
      void router.push("projectFoliosNew", {
        params: { projectSlug: project?.slug ?? "" },
      });
    };
    map["folio.newDirectory"] = () => treeActions?.createDirectory();
    map["view.tree"] = () => panes.toggleTree();
    map["view.focus"] = () => panes.toggleFocus();
    return map;
  }, [treeActions, panes, project?.slug, router]);

  // The client is asked directly, the same question `useFolioActions` asks.
  const state: FolioActionState = {
    ...EMPTY_STATE_ACTION_STATE,
    readOnly: !folioApi.update.can(),
  };

  // The keyboard half. `FolioDocument` binds the shortcuts on every other
  // state and is not mounted here, so the menubar below advertised ⌘\ and ⌘.
  // while nothing listened for them.
  useFolioShortcuts(handlers, state, "view");

  return (
    <div className="bg-background min-w-0 flex-1">
      {/* The menubar is portalled into the shell's chrome slot from inside
          the document on every other state, so this state renders it
          directly. `noFolio` keeps every menu's item list identical to the
          open state and only flips enablement. */}
      {shell.chromeSlot &&
        createPortal(
          <FolioMenubar handlers={handlers} state={state} />,
          shell.chromeSlot,
        )}
      <FolioEmptyState
        onCreate={
          folioApi.update.can()
            ? () =>
                router.push("projectFoliosNew", {
                  params: { projectSlug: project?.slug ?? "" },
                })
            : undefined
        }
      />
    </div>
  );
};

export default FolioWorkspaceEmpty;
