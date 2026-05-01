import type { Page } from "alepha";
import type { FileController } from "alepha/api/files";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Download, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
  const { l } = useI18n();
  const [refreshKey, setRefreshKey] = useState(0);

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.findFiles({ query: params as never });
      return res as Page<any>;
    },
    [client, refreshKey],
  );

  const handleDelete = async (file: any) => {
    const ok = await dialog.confirm({
      title: "Delete file",
      description: `Permanently delete "${file.fileName}"?`,
      destructive: true,
    });
    if (!ok) return;
    await client.deleteFile({ params: { id: file.id } });
    toast.success("File deleted");
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="p-6">
      <AlephaTable
        fetch={fetcher}
        header={
          <div>
            <h1 className="text-lg font-semibold">Files</h1>
            <p className="text-muted-foreground text-sm">
              Stored files across configured buckets.
            </p>
          </div>
        }
        columns={{
          fileName: {
            label: "Name",
            cell: (f) => <span className="font-medium">{f.fileName}</span>,
          },
          size: {
            label: "Size",
            align: "right",
            cell: (f) => (
              <span className="text-muted-foreground text-xs">
                {formatBytes(f.size ?? 0)}
              </span>
            ),
          },
          mimeType: {
            label: "Type",
            cell: (f) => (
              <Badge variant="secondary">{f.mimeType ?? "unknown"}</Badge>
            ),
          },
          bucket: {
            label: "Bucket",
            cell: (f) => <code className="text-xs">{f.bucket ?? "—"}</code>,
          },
          createdAt: {
            label: "Uploaded",
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
            label: "Download",
            icon: Download,
            onClick: () => {
              if (f.url) window.open(f.url, "_blank");
            },
          },
          {
            label: "Delete",
            icon: Trash2,
            destructive: true,
            onClick: () => handleDelete(f),
          },
        ]}
      />
    </div>
  );
}
