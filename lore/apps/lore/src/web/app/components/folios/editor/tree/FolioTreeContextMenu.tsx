import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@alepha/ui/components/ui/context-menu";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Copy,
  ExternalLink,
  FilePlus,
  FolderPlus,
  Link2,
  Pencil,
  Pin,
  PinOff,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import type { ReactElement } from "react";

import type { AppRouter } from "../../../../AppRouter.ts";
import type { I18n } from "../../../../services/I18n.ts";
import type { FolioTreeNode } from "./folioTreeModel.ts";
import type { FolioTreeState } from "./useFolioTreeModel.ts";

export interface FolioTreeContextMenuProps {
  node: FolioTreeNode;
  tree: FolioTreeState;
  projectSlug: string;
}

/**
 * The right-click menu content for one tree row, contents varying by
 * `node.kind`. Deliberately does NOT offer "Remove protection" for a
 * protected folio — see the file doc below.
 *
 * `Rename` and `Duplicate` are safe for a protected-and-still-locked folio
 * without needing to unlock it first: rename only ever sends `title`
 * (never `content`), so the server's protected-content guard
 * (`FolioController.update`) never engages, and duplicate copies the
 * ciphertext `content` byte-for-byte rather than decrypting it — see
 * `useFolioTreeModel`'s `duplicateAction` doc.
 *
 * ## Why there is no "Remove protection" item
 *
 * The brief's Step 6 key list includes
 * `folios.editor.tree.remove-protection`, but `useFolioTreeModel`'s
 * interface has no method that could back it: removing protection means
 * writing `protected: false` together with the PLAINTEXT `content`
 * (`FolioController.update`'s own invariant — see
 * `apps/lore/CLAUDE.md`'s protection-domain section), and the tree only
 * ever has the ciphertext for an arbitrary node. Sending the ciphertext
 * back as if it were plaintext would corrupt the folio, not declassify it.
 * The document pane's own `useFolioActions` CAN do this correctly, but
 * only for the folio it currently has open and already unlocked in this
 * session (`draft.values.content` is real plaintext there) — a capability
 * this tree has no access to for an arbitrary right-clicked node. Rather
 * than wire a menu item that either does nothing or does something unsafe,
 * this key is left unused; see the task report for the full reasoning.
 */
const FolioTreeContextMenu = (
  props: FolioTreeContextMenuProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const node = props.node;
  const isDirectory = node.kind === "directory";

  const hrefFor = (): string =>
    isDirectory
      ? `${router.path("projectFolios", { params: { projectSlug: props.projectSlug } })}?dir=${node.shortId}`
      : router.path("projectFoliosFolio", {
          params: { projectSlug: props.projectSlug, shortId: node.shortId },
        });

  const handleOpen = (): void => {
    void router.push(hrefFor());
  };

  const handleOpenNewTab = (): void => {
    window.open(hrefFor(), "_blank", "noopener,noreferrer");
  };

  const handleCopyWikiLink = (): void => {
    void navigator.clipboard.writeText(`[[${node.name}]]`);
  };

  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={handleOpen}>
        <ExternalLink className="size-4" />
        {tr("folios.editor.tree.open")}
      </ContextMenuItem>
      <ContextMenuItem onClick={handleOpenNewTab}>
        <SquareArrowOutUpRight className="size-4" />
        {tr("folios.editor.tree.open-new-tab")}
      </ContextMenuItem>
      <ContextMenuSeparator />
      {isDirectory ? (
        <>
          <ContextMenuItem onClick={() => props.tree.createFolio(node.id)}>
            <FilePlus className="size-4" />
            {tr("folios.editor.tree.new-folio")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => props.tree.createDirectory(node.id)}>
            <FolderPlus className="size-4" />
            {tr("folios.editor.tree.new-directory")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => props.tree.beginRename(node.id)}>
            <Pencil className="size-4" />
            {tr("folios.editor.tree.rename")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => props.tree.remove(node)}
          >
            <Trash2 className="size-4" />
            {tr("folio.action.delete")}
          </ContextMenuItem>
        </>
      ) : (
        <>
          <ContextMenuItem onClick={() => props.tree.beginRename(node.id)}>
            <Pencil className="size-4" />
            {tr("folios.editor.tree.rename")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => props.tree.duplicate(node)}>
            <Copy className="size-4" />
            {tr("folio.action.duplicate")}
          </ContextMenuItem>
          <ContextMenuItem onClick={handleCopyWikiLink}>
            <Link2 className="size-4" />
            {tr("folios.editor.tree.copy-wiki-link")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => props.tree.togglePin(node)}>
            {node.pinned ? (
              <PinOff className="size-4" />
            ) : (
              <Pin className="size-4" />
            )}
            {node.pinned
              ? tr("folios.editor.action.unpin")
              : tr("folios.editor.action.pin")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => props.tree.remove(node)}
          >
            <Trash2 className="size-4" />
            {tr("folio.action.delete")}
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
};

export default FolioTreeContextMenu;
