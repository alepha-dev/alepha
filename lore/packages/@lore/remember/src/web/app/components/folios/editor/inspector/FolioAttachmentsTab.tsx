import { Button, useDialog, useToast, cn } from "@alepha/ui";
import { resizeImage } from "@alepha/ui/form";
import {
  type I18n,
  attachmentPreview,
  formatAttachmentBytes,
} from "@lore/core/web";
import { AlephaError } from "alepha";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  Copy,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { type DragEvent, type ReactElement, useRef, useState } from "react";

import type { FolioAttachmentController } from "../../../../../../api/controllers/FolioAttachmentController.ts";
import { currentFolioAttachmentsAtom } from "../../../../atoms/currentFolioAttachmentsAtom.ts";
import { folioAssetEmbed } from "../../folioAssetReference.ts";
import { FOLIO_IMAGE_MAX_WIDTH } from "../../folioImageBounds.ts";

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
  /**
   * After a rename, with the stored name (the server may have suffixed
   * it). The server rewrote the folio's references; the open draft needs
   * the same rewrite, or its next autosave writes the old ones back.
   */
  onRenamed?: (from: string, to: string) => void;
}

/**
 * The Attachments tab — the only place folio attachments are managed.
 *
 * That is not an incidental fact: attachments used to be rows in the folio
 * tree, and the tree was where upload/rename/delete lived. When an
 * attachment became something that belongs to ONE folio rather than sitting
 * in a folder, the tree lost both the data and the UI, and this pane
 * inherited them.
 *
 * Empty, the tab is one drop zone that is also the picker. With files, a
 * summary line and an Add button sit over a two-column grid of cards: an
 * image is its own preview, any other file shows its extension, and the
 * three actions (rename, copy reference, delete) surface on hover or focus.
 * A drag anywhere over the tab outlines it as the target.
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
      handler: async (_ctx, files) => {
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
      handler: async (_ctx, id, name) => {
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
      handler: async (_ctx, id, current) => {
        const next = await dialog.prompt({
          title: tr("folios.editor.inspector.attachments-rename-title"),
          description: tr("folios.editor.inspector.attachments-rename-body"),
          defaultValue: current,
        });
        if (!next || next.trim() === current) return;
        const renamed = await attachmentApi.renameAttachment({
          params: { id },
          body: { name: next.trim() },
        });
        // The server rewrote the folio's references to the name it STORED,
        // which auto-suffixing may have changed from the one just typed;
        // the open draft follows it (#Q2550).
        props.onRenamed?.(current, renamed.name);
        // Re-read rather than patching the row, for the same suffixing.
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

  const browse = () => picker.current?.click();
  const actionClass =
    "text-muted-foreground hover:text-foreground hover:bg-hover flex size-6 items-center justify-center rounded disabled:opacity-40";

  return (
    <div
      className="relative flex flex-col gap-3 p-3"
      onDragOver={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        // Only when the pointer leaves the tab, not when it crosses a child.
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDropping(false);
        }
      }}
      onDrop={onDrop}
    >
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

      {attachments.length === 0 ? (
        canUpload ? (
          // The empty state IS the target: one place to drop, or to click.
          <button
            type="button"
            onClick={browse}
            disabled={busy}
            className={cn(
              "border-border hover:border-primary/50 hover:bg-primary/5 flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
              dropping && "border-primary bg-primary/5",
            )}
          >
            <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
            </span>
            <span className="text-sm font-medium">
              {tr("folios.editor.inspector.attachments-drop")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("folios.editor.inspector.attachments-browse")}
            </span>
          </button>
        ) : (
          <p className="text-muted-foreground py-4 text-center text-xs italic">
            {tr("folios.editor.inspector.attachments-empty")}
          </p>
        )
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {tr("folios.editor.inspector.attachments-total", {
                args: [
                  String(attachments.length),
                  formatAttachmentBytes(total),
                ],
              })}
            </span>
            {canUpload && (
              <Button
                type="button"
                size="sm"
                variant="outlined"
                disabled={busy}
                loading={uploadAction.loading}
                onClick={browse}
                className="h-7 text-xs"
              >
                <Plus className="size-3.5" />
                {tr("folios.editor.inspector.attachments-add")}
              </Button>
            )}
          </div>

          <ul className="grid grid-cols-2 gap-2">
            {attachments.map((attachment) => {
              const href = `/api/files/${attachment.id}`;
              const isImage =
                attachmentPreview(attachment.name, attachment.mimeType).kind ===
                "image";
              const dot = attachment.name.lastIndexOf(".");
              const extension =
                dot > 0 ? attachment.name.slice(dot + 1).toUpperCase() : "";
              return (
                <li
                  key={attachment.id}
                  className="border-border bg-background group relative flex min-w-0 flex-col overflow-hidden rounded-lg border"
                >
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={attachment.name}
                    className="bg-muted/40 flex aspect-[4/3] items-center justify-center overflow-hidden"
                  >
                    {isImage ? (
                      <img
                        src={href}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="text-muted-foreground flex flex-col items-center gap-1">
                        <FileText className="size-6" />
                        {extension && (
                          <span className="font-mono text-[10px] tracking-wide">
                            {extension}
                          </span>
                        )}
                      </span>
                    )}
                  </a>
                  <div className="border-border border-t px-2 py-1.5">
                    <p
                      className="truncate text-xs font-medium"
                      title={attachment.name}
                    >
                      {attachment.name}
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      {formatAttachmentBytes(attachment.size)}
                    </p>
                  </div>
                  {/* On hover or keyboard focus, over the preview's corner. */}
                  <div className="bg-background/95 border-border absolute top-1.5 right-1.5 flex gap-0.5 rounded-md border p-0.5 opacity-0 shadow-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => copyReference(attachment.name)}
                      aria-label={tr(
                        "folios.editor.inspector.attachments-copy-ref",
                      )}
                      title={tr("folios.editor.inspector.attachments-copy-ref")}
                      className={actionClass}
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={props.disabled || !canWrite || busy}
                      onClick={() =>
                        void renameAction.run(attachment.id, attachment.name)
                      }
                      aria-label={tr("folios.editor.tree.rename")}
                      title={tr("folios.editor.tree.rename")}
                      className={actionClass}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={props.disabled || !canWrite || busy}
                      onClick={() =>
                        void removeAction.run(attachment.id, attachment.name)
                      }
                      aria-label={tr("folio.action.delete")}
                      title={tr("folio.action.delete")}
                      className={cn(actionClass, "hover:text-danger-text")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* A drag over a tab that already has files: the whole tab is the
          target, outlined, with the instruction over it. */}
      {dropping && attachments.length > 0 && (
        <div className="bg-background/85 border-primary pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed">
          <span className="text-primary flex items-center gap-2 text-sm font-medium">
            <Upload className="size-4" />
            {tr("folios.editor.inspector.attachments-drop")}
          </span>
        </div>
      )}
    </div>
  );
};

export default FolioAttachmentsTab;
