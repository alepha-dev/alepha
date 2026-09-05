import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { resizeImage } from "@alepha/ui/lib/resize-image";
import { AlephaError } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Copy, Loader2, Paperclip, Pencil, Trash2, Upload } from "lucide-react";
import { type DragEvent, type ReactElement, useRef, useState } from "react";

import type { FolioAttachmentController } from "@/api/controllers/FolioAttachmentController.ts";

import { currentFolioAttachmentsAtom } from "../../../../atoms/currentFolioAttachmentsAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { folioAssetEmbed } from "../../folioAssetReference.ts";
import { FOLIO_IMAGE_MAX_WIDTH } from "../../folioImageBounds.ts";
import { formatAttachmentBytes } from "../../folioWikiLinkResolver.ts";

// Mirrors `FolioAttachmentService.BUCKET` — not imported so the
// browser bundle does not pull a server-side module. Value stays
// "archive-blobs": it is persisted on every existing `files` row.
const FOLIO_ATTACHMENT_BUCKET = "archive-blobs";

export interface FolioAttachmentsTabProps {
  /**
   * `undefined` in create mode — there is no folio to attach anything to
   * until the first save.
   */
  folioId?: string;
  projectId?: number;
  /**
   * Protected folios refuse attachments: plaintext bytes must not sit
   * beside encrypted content. Mirrors `useFolioImageUpload`'s own gate.
   */
  disabled?: boolean;
}

/**
 * The Attachments tab — the only place folio attachments are managed.
 *
 * That is not an incidental fact: attachments used to be rows in the folio
 * tree, and the tree was where upload/rename/delete lived. When an
 * attachment became something that belongs to ONE folio rather than sitting
 * in a folder, the tree lost both the data and the UI, and this pane
 * inherited them.
 */
const FolioAttachmentsTab = (props: FolioAttachmentsTabProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const attachmentApi = useClient<FolioAttachmentController>();
  const [attachments, setAttachments] = useStore(currentFolioAttachmentsAtom);
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const canUpload = !!props.folioId && !!props.projectId && !props.disabled;

  const refresh = async (): Promise<void> => {
    if (!props.folioId) return;
    setAttachments(
      await attachmentApi.listAttachments({
        params: { folioId: props.folioId },
      }),
    );
  };

  const upload = async (files: File[]): Promise<void> => {
    const { folioId, projectId } = props;
    if (!canUpload || !folioId || !projectId || files.length === 0) return;
    setBusy(true);
    try {
      for (const original of files) {
        // Always downscaled before the bytes leave the machine. Best-effort
        // by design: an SVG, a non-raster file, or a browser without
        // `OffscreenCanvas` comes back untouched, and the storage's own
        // `maxSize` remains what actually bounds the pathological case.
        const file = await resizeImage(original, {
          maxWidth: FOLIO_IMAGE_MAX_WIDTH,
        });
        const form = new FormData();
        form.append("file", file);
        const uploaded = await fetch(
          `/api/files?bucket=${encodeURIComponent(FOLIO_ATTACHMENT_BUCKET)}`,
          { method: "POST", body: form, credentials: "include" },
        );
        if (!uploaded.ok) {
          throw new AlephaError(
            `${original.name} — upload failed (${uploaded.status})`,
          );
        }
        const { id } = (await uploaded.json()) as { id: string };
        await attachmentApi.registerAttachment({
          params: { projectId },
          body: { fileId: id, name: file.name, folioId },
        });
      }
      // Re-read rather than appending the `registerAttachment` rows: the list has
      // to carry `size` and `mimeType`, which only the hydrated read
      // returns, and the server may have auto-suffixed the name.
      await refresh();
    } catch (error) {
      await dialog.alert({
        title: tr("folios.editor.inspector.attachments-upload-failed"),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string): Promise<void> => {
    const confirmed = await dialog.confirm({
      title: tr("folios.editor.inspector.attachments-confirm-delete-title"),
      description: tr("folios.editor.inspector.attachments-confirm-delete", {
        args: [name],
      }),
      destructive: true,
    });
    if (!confirmed) return;
    await attachmentApi.deleteAttachment({ params: { id } });
    setAttachments(attachments.filter((attachment) => attachment.id !== id));
  };

  const rename = async (id: string, current: string): Promise<void> => {
    const next = await dialog.prompt({
      title: tr("folios.editor.inspector.attachments-rename-title"),
      description: tr("folios.editor.inspector.attachments-rename-body"),
      defaultValue: current,
    });
    if (!next || next.trim() === current) return;
    await attachmentApi.renameAttachment({
      params: { id },
      body: { name: next.trim() },
    });
    // Re-read rather than patching the row: the server auto-suffixes on
    // collision, so the name it stored may not be the one just typed — and
    // it has also rewritten the folio's references to match.
    await refresh();
  };

  const copyReference = (name: string): void => {
    void navigator.clipboard.writeText(folioAssetEmbed(name));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDropping(false);
    void upload([...event.dataTransfer.files]);
  };

  const total = attachments.reduce(
    (sum, attachment) => sum + attachment.size,
    0,
  );

  if (!props.folioId) {
    return (
      <p className="text-muted-foreground px-3 py-4 text-center text-xs italic">
        {tr("folios.editor.inspector.attachments-unsaved")}
      </p>
    );
  }

  return (
    <div
      className={
        dropping
          ? "ring-primary/40 bg-primary/5 flex flex-col ring-1 ring-inset"
          : "flex flex-col"
      }
      onDragOver={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canUpload || busy}
          onClick={() => picker.current?.click()}
          className="h-7 text-xs"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          {tr("folios.editor.inspector.attachments-add")}
        </Button>
        <input
          ref={picker}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            void upload([...(event.target.files ?? [])]);
            // Reset so picking the same file twice in a row still fires.
            event.target.value = "";
          }}
        />
      </div>

      {attachments.length === 0 ? (
        <p className="text-muted-foreground px-3 py-4 text-center text-xs italic">
          {tr("folios.editor.inspector.attachments-empty")}
        </p>
      ) : (
        <ul className="flex flex-col">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="hover:bg-accent/50 group flex items-center gap-2 px-3 py-1.5"
            >
              {attachment.mimeType.startsWith("image/") ? (
                <img
                  src={`/api/files/${attachment.id}`}
                  alt=""
                  className="border-border size-8 flex-none rounded border object-cover"
                />
              ) : (
                <span className="bg-muted text-muted-foreground flex size-8 flex-none items-center justify-center rounded">
                  <Paperclip className="size-3.5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <a
                  href={`/api/files/${attachment.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-xs hover:underline"
                  title={attachment.name}
                >
                  {attachment.name}
                </a>
                <span className="text-muted-foreground block text-[11px]">
                  {formatAttachmentBytes(attachment.size)}
                </span>
              </span>
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => void rename(attachment.id, attachment.name)}
                aria-label={String(tr("folios.editor.tree.rename"))}
                title={String(tr("folios.editor.tree.rename"))}
                className="text-muted-foreground hover:text-foreground flex size-6 flex-none items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => copyReference(attachment.name)}
                aria-label={String(
                  tr("folios.editor.inspector.attachments-copy-ref"),
                )}
                title={String(
                  tr("folios.editor.inspector.attachments-copy-ref"),
                )}
                className="text-muted-foreground hover:text-foreground flex size-6 flex-none items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Copy className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => void remove(attachment.id, attachment.name)}
                aria-label={String(tr("folio.action.delete"))}
                title={String(tr("folio.action.delete"))}
                className="text-muted-foreground hover:text-destructive flex size-6 flex-none items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {attachments.length > 0 && (
        <p className="text-muted-foreground border-border border-t px-3 py-2 text-[11px]">
          {tr("folios.editor.inspector.attachments-total", {
            args: [String(attachments.length), formatAttachmentBytes(total)],
          })}
        </p>
      )}
    </div>
  );
};

export default FolioAttachmentsTab;
