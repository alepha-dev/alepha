import { Button, useDialog, useToast } from "@alepha/ui";
import { resizeImage } from "@alepha/ui/form";
import { AlephaError } from "alepha";
import { useAction, useClient, useStore } from "alepha/react";
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
  const [dropping, setDropping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const toaster = useToast();

  // The list stays: an attachment is content, and a reader needs to be able
  // to copy its reference. Upload, rename and delete are what close.
  const canWrite = attachmentApi.registerAttachment.can();
  const canUpload =
    !!props.folioId && !!props.projectId && !props.disabled && canWrite;

  // The list, back into the atom the route loader filled. A `useAction`
  // (#E59, #Q2331) run inside the writes below: a failed re-read is toasted
  // by the root `ActionErrorToaster` on its own.
  const refreshAction = useAction<[], void>(
    {
      handler: async () => {
        if (!props.folioId) return;
        setAttachments(
          await attachmentApi.listAttachments({
            params: { folioId: props.folioId },
          }),
        );
      },
    },
    [attachmentApi, props.folioId],
  );

  /**
   * Upload the picked or dropped files, one after another.
   *
   * A `useAction` whose failure is shown in this pane's own alert, with the
   * file's name in it (`onError`), so the root `ActionErrorToaster` leaves it
   * alone. The raw `fetch()` is the file endpoint's, which the client does
   * not wrap; its refusal is thrown as an `AlephaError` like any other.
   */
  const uploadAction = useAction<[files: File[]], void>(
    {
      handler: async (files) => {
        const { folioId, projectId } = props;
        if (!canUpload || !folioId || !projectId || files.length === 0) {
          return;
        }
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
        // Re-read rather than appending the `registerAttachment` rows: the
        // list has to carry `size` and `mimeType`, which only the hydrated
        // read returns, and the server may have auto-suffixed the name.
        await refreshAction.run();
      },
      onError: async (error) => {
        await dialog.alert({
          title: tr("folios.editor.inspector.attachments-upload-failed"),
          description: error.message,
        });
      },
    },
    [attachmentApi, canUpload, props.folioId, props.projectId, dialog, tr],
  );

  const removeAction = useAction<[id: string, name: string], void>(
    {
      handler: async (id, name) => {
        const confirmed = await dialog.confirm({
          title: tr("folios.editor.inspector.attachments-confirm-delete-title"),
          description: tr(
            "folios.editor.inspector.attachments-confirm-delete",
            { args: [name] },
          ),
          destructive: true,
        });
        if (!confirmed) return;
        await attachmentApi.deleteAttachment({ params: { id } });
        setAttachments(
          attachments.filter((attachment) => attachment.id !== id),
        );
      },
    },
    [attachmentApi, attachments, dialog, tr],
  );

  const renameAction = useAction<[id: string, current: string], void>(
    {
      handler: async (id, current) => {
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
        // collision, so the name it stored may not be the one just typed —
        // and it has also rewritten the folio's references to match.
        await refreshAction.run();
      },
    },
    [attachmentApi, dialog, tr],
  );

  // Page-wide across the pane's three writes (#E59 rule 10).
  const busy =
    uploadAction.loading || removeAction.loading || renameAction.loading;

  /**
   * Start an upload, or say why not: `run()` drops a batch made while one is
   * in flight, which would lose a dropped file without a word.
   */
  const upload = (files: File[]): void => {
    if (busy) {
      toaster.show(tr("folios.editor.inspector.attachments-busy"), "warning");
      return;
    }
    void uploadAction.run(files);
  };

  const copyReference = (name: string): void => {
    void navigator.clipboard.writeText(folioAssetEmbed(name));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDropping(false);
    upload([...event.dataTransfer.files]);
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
            upload([...(event.target.files ?? [])]);
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
                disabled={props.disabled || !canWrite || busy}
                onClick={() =>
                  void renameAction.run(attachment.id, attachment.name)
                }
                aria-label={tr("folios.editor.tree.rename")}
                title={tr("folios.editor.tree.rename")}
                className="text-muted-foreground hover:text-foreground flex size-6 flex-none items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => copyReference(attachment.name)}
                aria-label={tr("folios.editor.inspector.attachments-copy-ref")}
                title={tr("folios.editor.inspector.attachments-copy-ref")}
                className="text-muted-foreground hover:text-foreground flex size-6 flex-none items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Copy className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={props.disabled || !canWrite || busy}
                onClick={() =>
                  void removeAction.run(attachment.id, attachment.name)
                }
                aria-label={tr("folio.action.delete")}
                title={tr("folio.action.delete")}
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
