import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import type { ReactElement } from "react";
import type { Folio } from "@/api/entities/folios.ts";
import { projectDirectoriesAtom } from "../../../../atoms/projectDirectoriesAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import MarkdownEditor from "../../../shared/markdown-editor/MarkdownEditor.tsx";
import FolioPassphraseDialog from "../../FolioPassphraseDialog.tsx";
import type { UseFolioActionsResult } from "../useFolioActions.ts";
import type { FolioDraft } from "../useFolioDraft.ts";
import FolioLockedPanel from "./FolioLockedPanel.tsx";
import FolioMetaBar from "./FolioMetaBar.tsx";
import FolioMoveDialog from "./FolioMoveDialog.tsx";
import FolioSummaryField from "./FolioSummaryField.tsx";
import FolioTitleField from "./FolioTitleField.tsx";

export interface FolioDocumentProps {
  /**
   * `undefined` → create mode.
   */
  folio?: Folio;
  /**
   * Create-mode only: the directory the new folio will land in (carried
   * from `FolioCreatePage`'s `?dir=` resolution). Read only when `folio` is
   * unset — an existing folio's real `directoryId` always wins once it
   * exists. Without this, the meta bar's directory chip showed "Project
   * root" while creating a folio from inside a directory (via "+ Create →
   * New folio"), even though the folio was about to be created there.
   */
  directoryId?: string;
  draft: FolioDraft;
  actions: UseFolioActionsResult;
  /**
   * Revision count for the meta bar's "$3 revisions" — sourced from the
   * inspector's History tab (`FolioInspector`'s `onRevisionCount`), via
   * `FolioWorkspaceContent`. `undefined` until that tab's own
   * `listHistory` fetch resolves (or in create mode, where there is no
   * history yet); the meta bar already handles that (`revisionCount ?? 0`).
   */
  revisionCount?: number;
  imageUploadHandler?: (file: File) => Promise<string>;
}

/**
 * Rough word count over the raw markdown — deliberately not stripping
 * syntax (`#`, `*`, links): a whitespace split is the honest "how much did
 * you type" number the meta bar wants, matching the same level of
 * simplicity as the deleted `FolioEditor.tsx`'s token estimator
 * (`Math.ceil(content.length / 4)`), not a prose-accurate word counter.
 */
const countWords = (content: string): number => {
  const trimmed = content.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
};

/**
 * The document column: title → meta bar → summary → divider → body. Body
 * is either the editable MDXEditor or, for a protected-and-still-locked
 * folio, `FolioLockedPanel` in its place.
 */
const FolioDocument = (props: FolioDocumentProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const [directories] = useStore(projectDirectoriesAtom);

  const values = props.draft.values;
  const disabled = props.actions.locked;

  // `props.actions.directoryId` (LIVE — moved by `confirmMove`'s own
  // success), NOT `props.folio?.directoryId`. The latter is the
  // route-loader snapshot: reading it directly here reproduced the exact
  // staleness bug the reviewer flagged for `isProtected` elsewhere in this
  // task, just for the directory chip instead — after a successful
  // in-session move, the chip kept showing the OLD directory until a full
  // reload. In create mode `props.actions.directoryId` is always
  // `undefined` (no folio yet), so this falls through to the create-mode
  // target directory (`props.directoryId`) so the chip shows where the
  // folio WILL land, not always "Project root" while creating.
  const directoryId = props.actions.directoryId ?? props.directoryId;
  const directoryName = directoryId
    ? (directories.find((d) => d.id === directoryId)?.name ?? "…")
    : tr("folio.move.root");

  const handleAddTag = async () => {
    const value = await dialog.prompt({
      title: tr("folios.editor.tag.add"),
      placeholder: String(tr("folios.editor.tag.add")),
    });
    const trimmed = value?.trim();
    if (!trimmed) return;
    if (values.tags.includes(trimmed)) return;
    props.draft.form.input.tags.set([...values.tags, trimmed]);
  };

  const handleRemoveTag = (tag: string) => {
    props.draft.form.input.tags.set(values.tags.filter((t) => t !== tag));
  };

  return (
    <div className="flex flex-col gap-0">
      <FolioTitleField
        value={values.title}
        onChange={(v) => props.draft.form.input.title.set(v)}
        disabled={disabled}
      />

      <FolioMetaBar
        directoryName={directoryName}
        tags={values.tags}
        shortId={props.folio?.shortId}
        wordCount={countWords(values.content)}
        revisionCount={props.revisionCount}
        disabled={disabled}
        moveDisabled={!props.folio}
        onOpenMove={() => props.actions.handlers["folio.move"]()}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
      />

      <FolioSummaryField
        value={values.summary}
        onChange={(v) => props.draft.form.input.summary.set(v)}
        unavailable={props.actions.actionState.isProtected}
      />

      <div className="border-border my-6 border-t" />

      {props.actions.locked ? (
        <FolioLockedPanel
          onUnlock={props.actions.unlock}
          onDelete={() => props.actions.handlers["folio.delete"]()}
        />
      ) : (
        <MarkdownEditor
          value={values.content}
          onChange={(v) => props.draft.form.input.content.set(v)}
          placeholder={tr("folios.content-placeholder")}
          imageUploadHandler={props.imageUploadHandler}
          minHeight={420}
        />
      )}

      <FolioMoveDialog
        open={props.actions.moveDialogOpen}
        folioTitle={
          values.title.trim() || String(tr("folios.title-placeholder"))
        }
        currentDirectoryId={directoryId}
        onCancel={props.actions.closeMoveDialog}
        onConfirm={props.actions.confirmMove}
      />

      <FolioPassphraseDialog
        open={props.actions.encryptDialogOpen}
        onOpenChange={(open) => {
          if (!open) props.actions.closeEncryptDialog();
        }}
        title={tr("folios.protected.encrypt-title")}
        description={tr("folios.protected.encrypt-description")}
        submitLabel={tr("folios.protected.encrypt")}
        requireConfirm
        onSubmit={props.actions.confirmEncrypt}
      />
    </div>
  );
};

export default FolioDocument;
