import { FormField } from "@alepha/ui/components/control/form-field";
import { Button } from "@alepha/ui/components/ui/button";
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
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

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
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [meta, setMeta] = useState<Map<string, UploadedFileMeta>>(new Map());
  const [dragOver, setDragOver] = useState(false);

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
        const file = files[i];

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
    if (e.target.files) handleFiles(e.target.files);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (props.disabled) return;
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
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
    const isImage = item?.mimeType?.startsWith("image/");

    return (
      <div
        key={id}
        className="bg-muted/30 flex items-center gap-3 rounded-md border p-2"
      >
        {isImage && item?.previewUrl ? (
          <img
            src={item.previewUrl}
            alt={item.name}
            className="size-12 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center rounded">
            <FileIcon className="size-5" />
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1">
          <span className="truncate text-sm font-medium">
            {item?.name ?? id}
          </span>
          <span className="text-muted-foreground text-xs">
            {item?.mimeType ?? "uploaded"}
            {item?.size != null && ` · ${formatBytes(item.size)}`}
          </span>
        </div>
        {!props.disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={tr("controlUpload.remove", { default: "Remove" })}
            onClick={() => removeOne(id)}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
    );
  };

  const dropZone = (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={
        "rounded-md border border-dashed p-4 text-center text-sm transition " +
        (dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20")
      }
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.disabled || uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? (
          <>
            <Loader2 className="size-4 mr-1 animate-spin" />
            {tr("controlUpload.uploading", { default: "Uploading…" })}
          </>
        ) : (
          <>
            <Upload className="size-4 mr-1" />
            {props.multi
              ? tr("controlUpload.chooseFiles", { default: "Choose files" })
              : tr("controlUpload.chooseFile", { default: "Choose a file" })}
          </>
        )}
      </Button>
      <p className="text-muted-foreground mt-2 text-xs">
        {tr("controlUpload.dragDrop", { default: "or drag and drop here" })}
        {props.maxSize
          ? ` · ${tr("controlUpload.max", {
              default: `max ${formatBytes(props.maxSize)}`,
              args: [formatBytes(props.maxSize)],
            })}`
          : ""}
      </p>
    </div>
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
    </FormField>
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
