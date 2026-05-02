import type { Page } from "alepha";
import type { FileController } from "alepha/api/files";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Download, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlephaTable } from "@/registry/default/alepha-table/alepha-table";
import { useDialog } from "@/registry/default/use-dialog/use-dialog";

const formatBytes = (n: number) => {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  return `${(n / 1024 ** i).toFixed(1)} ${units[i]}`;
};

export function AdminFiles() {
  const client = useClient<FileController>();
  const dialog = useDialog();
  const { l, tr } = useI18n();
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await client.uploadFile({ body: { file } });
      toast.success(
        tr("admin.files.uploaded", {
          default: `Uploaded ${file.name}`,
          args: [file.name],
        }),
      );
      setRefreshKey((k) => k + 1);
    } catch (err) {
      const msg = (err as Error).message;
      toast.error(
        tr("admin.files.uploadFailed", {
          default: `Upload failed: ${msg}`,
          args: [msg],
        }),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.findFiles({ query: params as never });
      return res as Page<any>;
    },
    [client, refreshKey],
  );

  const handleDelete = async (file: any) => {
    const ok = await dialog.confirm({
      title: tr("admin.files.deleteTitle", { default: "Delete file" }),
      description: tr("admin.files.deleteConfirm", {
        default: `Permanently delete "${file.name}"?`,
        args: [file.name],
      }),
      destructive: true,
    });
    if (!ok) return;
    await client.deleteFile({ params: { id: file.id } });
    toast.success(tr("admin.files.deleted", { default: "File deleted" }));
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="p-6">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
      />
      <AlephaTable
        fetch={fetcher}
        header={
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">
                {tr("admin.files.title", { default: "Files" })}
              </h1>
              <p className="text-muted-foreground text-sm">
                {tr("admin.files.subtitle", {
                  default: "Stored files across configured buckets.",
                })}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4 mr-1" />
              {uploading
                ? tr("admin.files.uploading", { default: "Uploading…" })
                : tr("admin.files.upload", { default: "Upload" })}
            </Button>
          </div>
        }
        columns={{
          name: {
            label: tr("admin.files.colName", { default: "Name" }),
            cell: (f) => <span className="font-medium">{f.name}</span>,
          },
          size: {
            label: tr("admin.files.colSize", { default: "Size" }),
            align: "right",
            cell: (f) => (
              <span className="text-muted-foreground text-xs">
                {formatBytes(f.size ?? 0)}
              </span>
            ),
          },
          mimeType: {
            label: tr("admin.files.colType", { default: "Type" }),
            cell: (f) => (
              <Badge variant="secondary">
                {f.mimeType ??
                  tr("admin.files.unknown", { default: "unknown" })}
              </Badge>
            ),
          },
          bucket: {
            label: tr("admin.files.colBucket", { default: "Bucket" }),
            cell: (f) => <code className="text-xs">{f.bucket ?? "—"}</code>,
          },
          createdAt: {
            label: tr("admin.files.colUploaded", { default: "Uploaded" }),
            sortable: true,
            cell: (f) => (
              <span className="text-muted-foreground text-xs">
                {String(l(f.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
        }}
        rowActions={(f) => [
          {
            label: tr("admin.files.download", { default: "Download" }),
            icon: Download,
            onClick: () => {
              window.open(`/api/files/${f.id}`, "_blank");
            },
          },
          {
            label: tr("admin.files.delete", { default: "Delete" }),
            icon: Trash2,
            destructive: true,
            onClick: () => handleDelete(f),
          },
        ]}
      />
    </div>
  );
}
