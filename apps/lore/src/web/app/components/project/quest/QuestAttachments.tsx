import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Loader2, Plus } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import QuestAttachmentChip from "./QuestAttachmentChip.tsx";
import QuestAttachmentLightbox from "./QuestAttachmentLightbox.tsx";
import { attachmentPreview } from "./questAttachmentPreview.ts";

export interface QuestAttachmentsProps {
  /**
   * Omitted on the create form, where the quest does not exist yet.
   *
   * Without it there is no server lookup, and the chips run on the name and
   * type seeded from the picked `File`. That is enough: on that form every
   * attachment was uploaded moments ago in this same session.
   */
  questId?: number;
  value?: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

interface AttachmentMeta {
  fileId: string;
  name: string;
  mimeType: string;
}

/**
 * The attachments row: one chip per file, then the dashed upload chip.
 *
 * A new upload lands at the END of the row, just before the upload chip, and
 * only that chip plays the enter animation: it pops in where it was added
 * and pushes the upload chip along. Appending keeps the row stable, so a
 * file added earlier does not move every time another arrives.
 *
 * The file input accepts everything. The server's `mimeTypes` list is the
 * real gate and rejects what it will not serve safely, so restating a
 * narrower list in `accept` would only hide formats that upload fine.
 */
const QuestAttachments = (props: QuestAttachmentsProps) => {
  const questApi = useClient<QuestController>();
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<string[]>(props.value ?? []);
  const [newIds, setNewIds] = useState<string[]>([]);
  const [meta, setMeta] = useState<AttachmentMeta[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Names come from the server, keyed off the quest rather than looked up
  // per file: one call for the row, and it re-runs whenever the row changes
  // so an upload or a removal is reflected without a page reload.
  //
  // MERGED, never replaced. This call races the parent's own save: an upload
  // updates the row here first and the quest is persisted by `onChange`
  // afterwards, so the response can easily predate the new file and come
  // back without it. Replacing on that response dropped the entry seeded at
  // upload time, which is why a fresh attachment showed its uuid and the
  // wrong type until a reload, and why uploading a second one appeared to
  // "fix" the first.
  const signature = attachments.join(",");
  useEffect(() => {
    if (attachments.length === 0) {
      // The empty-input early return of the fetch effect below.
      // oxlint-disable-next-line react/set-state-in-effect
      setMeta([]);
      return;
    }
    if (props.questId === undefined) return;
    const questId = props.questId;
    let cancelled = false;
    void questApi
      .listQuestAttachments({ params: { id: questId } })
      .then((rows) => {
        if (cancelled) return;
        setMeta((prev) => {
          const byId = new Map(prev.map((m) => [m.fileId, m]));
          for (const row of rows) byId.set(row.fileId, row);
          return [...byId.values()];
        });
      })
      .catch(() => {
        // A failed lookup costs the filenames, not the row: the chips fall
        // back to the id below rather than disappearing.
      });
    return () => {
      cancelled = true;
    };
  }, [signature, props.questId]);

  const commit = (next: string[]) => {
    setAttachments(next);
    props.onChange(next);
  };

  /**
   * Upload a set of files and append them to the row.
   *
   * Shared by the picker, the drop zone and the paste handler, so a
   * screenshot pasted in behaves exactly like one chosen from the dialog.
   */
  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => {
          const result = await questApi.uploadAttachment({ body: { file } });
          // Seed the name and type from the File the browser already holds,
          // rather than waiting for the round trip that tells us what we
          // just sent. The chip is correct the instant it appears.
          return {
            fileId: result.fileId,
            name: file.name,
            mimeType: file.type,
          };
        }),
      );
      setMeta((prev) => [...prev, ...uploaded]);
      setNewIds(uploaded.map((it) => it.fileId));
      commit([...attachments, ...uploaded.map((it) => it.fileId)]);
    } catch (error) {
      toaster.error(tr("quest.view.attachFailed"));
      console.error("Attachment upload failed:", error);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void upload(Array.from(event.target.files ?? [])).finally(() => {
      // Clearing the input is what lets the same file be picked twice in a
      // row; without it the second pick fires no `change` event at all.
      event.target.value = "";
    });
  };

  // Ctrl/Cmd+V anywhere on the page, so a screenshot lands without hunting
  // for a drop target first. Bound to `window` and gated on `kind === "file"`
  // so pasting TEXT into the description beside this is untouched.
  useEffect(() => {
    if (props.disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const pasted: File[] = [];
      for (const item of e.clipboardData?.items ?? []) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        // Browsers paste every screenshot as "image.png"; stamping it keeps
        // the chips distinguishable when several are pasted in a row.
        const ext = file.name.includes(".")
          ? file.name.slice(file.name.lastIndexOf("."))
          : ".png";
        pasted.push(
          new File([file], `pasted-${Date.now()}${ext}`, { type: file.type }),
        );
      }
      if (pasted.length > 0) {
        e.preventDefault();
        void upload(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const metaOf = (fileId: string) => meta.find((m) => m.fileId === fileId);
  const isImage = (fileId: string) =>
    !!metaOf(fileId)?.mimeType.startsWith("image/");

  // Everything the dialog can actually show, in row order, so the carousel
  // steps through what the row shows rather than through upload order. A
  // file it cannot preview opens directly instead of trapping the reader in
  // an empty dialog.
  const previewable = attachments
    .map((id) => metaOf(id))
    .filter((m) => m !== undefined)
    .filter((m) => attachmentPreview(m.name, m.mimeType).kind !== "none");
  const canPreview = (fileId: string) =>
    previewable.some((m) => m.fileId === fileId);

  return (
    <div className="flex flex-col gap-2">
      {/* The whole row is the drop target, not just the Attach chip: a file
          dragged at a 40px button is a file dropped on the page behind it,
          which navigates away and loses the form. */}
      <div
        className={`flex flex-wrap items-center gap-2 rounded-md transition-colors ${
          dragging ? "outline-primary/60 outline-2 outline-dashed" : ""
        }`}
        onDragOver={(e) => {
          if (props.disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (props.disabled) return;
          e.preventDefault();
          setDragging(false);
          void upload(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          multiple
          className="hidden"
          disabled={props.disabled}
        />

        {attachments.map((fileId) => (
          <QuestAttachmentChip
            key={fileId}
            fileId={fileId}
            name={metaOf(fileId)?.name ?? `${fileId.slice(0, 8)}…`}
            isImage={isImage(fileId)}
            isNew={newIds.includes(fileId)}
            disabled={props.disabled}
            onOpen={(id) =>
              canPreview(id) ? setOpenId(id) : window.open(`/api/files/${id}`)
            }
            onRemove={(id) => commit(attachments.filter((it) => it !== id))}
          />
        ))}

        {!props.disabled && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            // `Input`'s own metrics, stroke included: h-8, rounded-lg,
            // border-input, solid, and the same transparent/`input-30`
            // surface. Nothing about it is bespoke any more.
            className="border-input text-muted-foreground hover:border-foreground/40 hover:text-foreground dark:bg-input/30 flex h-8 shrink-0 items-center gap-2 rounded-lg border bg-transparent px-2.5 text-sm transition-colors disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {tr("quest.view.attach")}
          </button>
        )}
      </div>

      {!props.disabled && (
        <p className="text-muted-foreground text-xs">
          {tr("quest.view.attachHint")}
        </p>
      )}

      <QuestAttachmentLightbox
        items={previewable}
        openId={openId}
        onOpenChange={(open) => !open && setOpenId(null)}
      />
    </div>
  );
};

export default QuestAttachments;
