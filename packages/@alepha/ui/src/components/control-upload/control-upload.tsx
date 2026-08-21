import * as React from "react";

void React;

import { FormField } from "@alepha/ui/components/control-base/form-field";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { FileController } from "alepha/api/files";
import { useClient } from "alepha/react";
import {
  type BaseInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { File as FileIcon, Loader2, Upload, X } from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  type ResizeImageOptions,
  resizeImage,
} from "../../lib/resize-image.ts";

export interface ControlUploadProps {
  /**
   * Bound `InputField` from `useForm`. Stores the uploaded file ID(s).
   */
  input: BaseInputField;
  /**
   * Field label. Falls back to schema `title`.
   */
  label?: string;
  /**
   * Helper text shown below the dropzone.
   */
  description?: string;
  /**
   * Multi-file mode. The form value becomes an `Array<string>` of file
   * IDs. Single mode (default) stores a bare UUID string.
   */
  multi?: boolean;
  /**
   * HTML `accept` filter on the file picker (e.g. `"image/*"`,
   * `".pdf,.docx"`).
   */
  accept?: string;
  /**
   * Max size per file (bytes). Files over the limit are rejected.
   */
  maxSize?: number;
  /**
   * Downscale images to these bounds before uploading.
   *
   * Set it wherever the result is rendered small — the bytes never leave the
   * machine, so it speeds up the upload as well as every later fetch. Applied
   * before {@link maxSize}, so a photo that would have been rejected for being
   * too large is resized and accepted instead.
   *
   * Best-effort by design: a browser without `OffscreenCanvas`, an SVG, or an
   * image the decoder chokes on is uploaded as-is, and the storage's own
   * `maxSize` remains what actually bounds it. That trade is deliberate — a
   * server-side codec able to close the gap costs more bundle than the case is
   * worth on an edge runtime, and encodes worse (see `files:beforeUpload` in
   * `alepha/api/files` for where it would attach if you want it anyway).
   *
   * @example { maxWidth: 256 }
   */
  image?: ResizeImageOptions;
  /**
   * Bucket name passed to the upload endpoint.
   */
  bucket?: string;
  /**
   * Disable the dropzone.
   */
  disabled?: boolean;
}

interface UploadedFileMeta {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  /**
   * Object URL for image preview, when applicable.
   */
  previewUrl?: string;
}

/**
 * File upload control. Wraps `FileController.uploadFile`, stores the
 * resulting file ID(s) in the form, and renders a thumbnail preview for
 * images and a chip-style summary for everything else.
 *
 * Single-file: form value is a uuid string.
 * Multi-file: form value is an array of uuid strings.
 */
export function ControlUpload(props: ControlUploadProps) {
  const form = useFormState(props.input, ["error"]);
  const [value, setValue] = useFieldValue(props.input);
  const client = useClient<FileController>();
  const { tr } = useI18n();
  const toast = useToast();
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [meta, setMeta] = useState<Map<string, UploadedFileMeta>>(new Map());
  const [dragOver, setDragOver] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  /**
   * Backfill `meta` for ids that arrived from form state (e.g. after a page
   * reload) so the renderer can show a thumbnail / chip instead of the raw
   * uuid. We can't infer the real mime type without an extra request, so we
   * fall back to a stub entry pointing at `/api/files/:id` and let the
   * `<img>` `onError` swap to the generic file chip.
   */
  useEffect(() => {
    const ids: string[] = props.multi
      ? Array.isArray(value)
        ? (value as string[])
        : []
      : value
        ? [value as string]
        : [];
    // Reconciles a cache of per-file metadata against the ids the field now
    // holds, and the entries it keeps were filled in by the upload requests this
    // same effect issues. It is the cache for an external system, not derived
    // state; the updater already no-ops when nothing changed.
    // oxlint-disable-next-line react/set-state-in-effect
    setMeta((current) => {
      let changed = false;
      const next = new Map(current);
      for (const id of ids) {
        if (!next.has(id)) {
          next.set(id, {
            id,
            name: id,
            previewUrl: `/api/files/${id}`,
          });
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [Array.isArray(value) ? value.join(",") : value, props.multi]);

  if (!props.input?.props) return null;

  const fieldMeta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  const ids: string[] = props.multi
    ? Array.isArray(value)
      ? (value as string[])
      : []
    : value
      ? [value as string]
      : [];

  const handleFiles = async (files: FileList) => {
    if (!files.length) return;
    if (!props.multi && files.length > 1) {
      toast.error(
        tr("controlUpload.singleOnly", { default: "Only one file allowed" }),
      );
      return;
    }

    setUploading(true);
    setProgress(0);
    const next = new Map(meta);
    const newIds: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        // Ahead of the size check on purpose: a 4 MB photo destined for a 32px
        // avatar should become a few kilobytes, not an error.
        const file = props.image
          ? await resizeImage(files[i], props.image)
          : files[i];

        if (props.maxSize && file.size > props.maxSize) {
          toast.error(
            tr("controlUpload.tooBig", {
              default: `${file.name} exceeds ${formatBytes(props.maxSize)}`,
              args: [file.name, formatBytes(props.maxSize)],
            }),
          );
          continue;
        }

        const resource = await client.uploadFile({
          body: { file },
          query: props.bucket ? { bucket: props.bucket } : ({} as never),
        });

        const previewUrl = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;

        next.set(resource.id, {
          id: resource.id,
          name: resource.name ?? file.name,
          mimeType: resource.mimeType ?? file.type,
          size: resource.size ?? file.size,
          previewUrl,
        });
        newIds.push(resource.id);
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }

      setMeta(next);
      if (props.multi) {
        setValue([...ids, ...newIds]);
      } else if (newIds[0]) {
        setValue(newIds[0]);
      }
      if (newIds.length) {
        toast.success(
          newIds.length === 1
            ? tr("controlUpload.uploadedOne", { default: "File uploaded" })
            : tr("controlUpload.uploadedMany", {
                default: `${newIds.length} files uploaded`,
                args: [String(newIds.length)],
              }),
        );
      }
    } catch (e) {
      const msg = (e as Error).message;
      toast.error(
        tr("controlUpload.failed", {
          default: `Upload failed: ${msg}`,
          args: [msg],
        }),
      );
    } finally {
      setUploading(false);
      setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void handleFiles(e.target.files);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (props.disabled) return;
    if (e.dataTransfer.files) void handleFiles(e.dataTransfer.files);
  };

  const removeOne = (id: string) => {
    const next = new Map(meta);
    const item = next.get(id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    next.delete(id);
    setMeta(next);

    if (props.multi) {
      setValue(ids.filter((it) => it !== id));
    } else {
      setValue(undefined);
    }
  };

  const renderItem = (id: string) => {
    const item = meta.get(id);
    const acceptsImage = (props.accept ?? "").includes("image");
    const mimeIsImage = item?.mimeType?.startsWith("image/");
    const isImage =
      mimeIsImage || (acceptsImage && !!item?.previewUrl && !item?.mimeType);

    const canClear = !props.disabled && !fieldMeta.required;

    return (
      <div
        key={id}
        className={`border-input dark:bg-input/30 relative flex h-9 cursor-zoom-in items-center rounded-md border bg-transparent pl-1 ${canClear ? "pr-9" : "pr-2"}`}
        onClick={() => setPreviewId(id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPreviewId(id);
          }
        }}
        role="button"
        tabIndex={0}
      >
        {isImage && item?.previewUrl ? (
          <ItemThumb url={item.previewUrl} alt={item.name ?? id} />
        ) : (
          <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded">
            <FileIcon className="size-4" />
          </div>
        )}
        {canClear && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeOne(id);
            }}
            aria-label={tr("controlUpload.remove", { default: "Remove" })}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 p-1"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    );
  };

  const previewItem = previewId ? meta.get(previewId) : undefined;
  const previewIsImage = previewItem
    ? previewItem.mimeType?.startsWith("image/") ||
      ((props.accept ?? "").includes("image") &&
        !!previewItem.previewUrl &&
        !previewItem.mimeType)
    : false;
  const previewHasName =
    !!previewItem?.name && previewItem.name !== previewItem.id;

  const dragDropHint =
    tr("controlUpload.dragDrop", { default: "Upload or drag and drop here" }) +
    (props.maxSize
      ? ` · ${tr("controlUpload.max", {
          default: `max ${formatBytes(props.maxSize)}`,
          args: [formatBytes(props.maxSize)],
        })}`
      : "");

  const dropZone = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.disabled || uploading}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={dragOver ? "border-primary bg-primary/5" : ""}
          />
        }
      >
        {uploading ? (
          <>
            <Loader2 className="mr-1 size-4 animate-spin" />
            {tr("controlUpload.uploading", { default: "Uploading…" })}
          </>
        ) : (
          <>
            <Upload className="mr-1 size-4" />
            {props.multi
              ? tr("controlUpload.chooseFiles", { default: "Choose files" })
              : tr("controlUpload.chooseFile", { default: "Choose a file" })}
          </>
        )}
      </TooltipTrigger>
      <TooltipContent>{dragDropHint}</TooltipContent>
    </Tooltip>
  );

  return (
    <FormField
      id={inputId}
      label={fieldMeta.label}
      description={fieldMeta.description}
      error={fieldMeta.error}
      required={fieldMeta.required}
    >
      <input
        ref={fileInputRef}
        type="file"
        id={inputId}
        name={props.input.props.name}
        className="hidden"
        accept={props.accept}
        multiple={props.multi}
        disabled={props.disabled}
        onChange={handleInputChange}
      />

      <div className="flex flex-col gap-2">
        {ids.length > 0 && (
          <div className="flex flex-col gap-2">{ids.map(renderItem)}</div>
        )}
        {(props.multi || ids.length === 0) && dropZone}
        {uploading && (
          <div className="bg-muted h-1 w-full overflow-hidden rounded">
            <div
              className="bg-primary h-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      <Dialog
        open={previewId !== null}
        onOpenChange={(o) => !o && setPreviewId(null)}
      >
        <DialogContent className="w-fit max-w-fit p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>
              {previewHasName
                ? previewItem?.name
                : tr("controlUpload.savedFile", { default: "Saved file" })}
            </DialogTitle>
            <DialogDescription>
              {previewItem?.mimeType ?? "uploaded"}
            </DialogDescription>
          </DialogHeader>
          <div className="p-4">
            {previewIsImage && previewItem?.previewUrl ? (
              <img
                src={previewItem.previewUrl}
                alt={previewItem.name ?? ""}
                className="size-72 rounded object-contain"
              />
            ) : (
              <div className="bg-muted text-muted-foreground flex size-72 items-center justify-center rounded">
                <FileIcon className="size-16" />
              </div>
            )}
          </div>
          {(previewHasName || previewItem?.mimeType) && (
            <div className="bg-muted/30 flex flex-col gap-0 border-t px-4 py-2">
              {previewHasName && (
                <span className="truncate text-sm font-medium">
                  {previewItem?.name}
                </span>
              )}
              {previewItem?.mimeType && (
                <span className="text-muted-foreground truncate text-xs">
                  {previewItem.mimeType}
                </span>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </FormField>
  );
}

function ItemThumb(props: { url: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded">
        <FileIcon className="size-4" />
      </div>
    );
  }
  return (
    <img
      src={props.url}
      alt={props.alt}
      className="size-7 shrink-0 rounded object-cover"
      onError={() => setBroken(true)}
    />
  );
}

const formatBytes = (n: number): string => {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  return `${(n / 1024 ** i).toFixed(1)} ${units[i]}`;
};
