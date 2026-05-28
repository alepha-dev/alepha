import * as React from "react";

void React;

import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@alepha/ui/components/ui/hover-card";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Page, type Static, t } from "alepha";
import type {
  AdminFileStatsController,
  FileController,
  FileResource,
} from "alepha/api/files";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Download, Search, Trash2, Upload } from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const formatBytes = (n: number) => {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(n) / Math.log(1024)),
  );
  return `${(n / 1024 ** i).toFixed(1)} ${units[i]}`;
};

// Filter schema at module scope so its identity stays stable across renders
// — AlephaTable's internal `useForm` captures it once.
const filtersSchema = t.object({
  name: t.optional(t.string()),
  bucket: t.optional(t.string()),
});
type AdminFileFilters = Static<typeof filtersSchema>;

const isImage = (mimeType?: string) => Boolean(mimeType?.startsWith("image/"));

export function AdminFiles() {
  const client = useClient<FileController>();
  const statsClient = useClient<AdminFileStatsController>();
  const dialog = useDialog();
  const { l, tr } = useI18n();
  const toast = useToast();
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [bucketItems, setBucketItems] = useState<
    { value: string; label: string }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Populate the bucket filter from storage stats. Re-runs after uploads so
  // counts (and any newly-created bucket) stay current.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stats = await statsClient.getFileStats({} as never);
      if (cancelled) return;
      setBucketItems(
        (stats.byBucket ?? []).map((b) => ({
          value: b.bucket,
          label: `${b.bucket} (${b.fileCount})`,
        })),
      );
    })().catch(() => {
      // The bucket filter degrades to empty if stats can't be fetched.
    });
    return () => {
      cancelled = true;
    };
  }, [statsClient, refreshKey]);

  const downloadFile = useCallback((f: FileResource) => {
    window.open(`/api/files/${f.id}`, "_blank");
  }, []);

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
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: AdminFileFilters;
    }) => {
      const res = await client.findFiles({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          name: params.filters?.name || undefined,
          bucket: params.filters?.bucket || undefined,
        } as never,
      });
      return res as Page<FileResource>;
    },
    [client, refreshKey],
  );

  const handleDelete = async (file: FileResource, refresh: () => void) => {
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
    refresh();
  };

  const handleBulkDelete = async (
    items: FileResource[],
    {
      clearSelection,
      refresh,
    }: { clearSelection: () => void; refresh: () => void },
  ) => {
    if (items.length === 0) return;
    const ok = await dialog.confirm({
      title: tr("admin.files.bulkDeleteTitle", { default: "Delete files" }),
      description: tr("admin.files.bulkDeleteConfirm", {
        default: `Permanently delete ${items.length} file(s)? This cannot be undone.`,
        args: [String(items.length)],
      }),
      destructive: true,
    });
    if (!ok) return;
    const res = await client.deleteFiles({
      body: { ids: items.map((f) => f.id) },
    });
    toast.success(
      tr("admin.files.bulkDeleted", {
        default: `${res.deleted.length} file(s) deleted`,
        args: [String(res.deleted.length)],
      }),
    );
    clearSelection();
    refresh();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
      />
      <AlephaTable<FileResource>
        className="min-h-0 flex-1"
        persistenceKey="admin.files"
        fetch={fetcher}
        actions={[
          {
            icon: Upload,
            label: uploading
              ? tr("admin.files.uploading", { default: "Uploading…" })
              : tr("admin.files.upload", { default: "Upload" }),
            disabled: uploading,
            onClick: () => fileInputRef.current?.click(),
          },
        ]}
        filters={{
          schema: filtersSchema,
          render: (form) => (
            <div className="flex items-center gap-2">
              <div className="w-64">
                <Control
                  input={form.input.name}
                  label=""
                  icon={Search}
                  placeholder={String(
                    tr("admin.files.searchPlaceholder", {
                      default: "Search by name…",
                    }),
                  )}
                />
              </div>
              <Control
                input={form.input.bucket}
                label=""
                clearable
                clearLabel={String(
                  tr("admin.files.allBuckets", { default: "All buckets" }),
                )}
                triggerClassName="w-48"
                placeholder={String(
                  tr("admin.files.bucketPlaceholder", { default: "Bucket" }),
                )}
                items={bucketItems}
              />
            </div>
          ),
        }}
        bulkActions={[
          {
            label: tr("admin.files.bulkDelete", {
              default: "Delete selected",
            }),
            icon: Trash2,
            destructive: true,
            onClick: handleBulkDelete,
          },
        ]}
        columns={{
          name: {
            label: tr("admin.files.colName", { default: "Name" }),
            cell: (f) => {
              const trigger = (
                <button
                  type="button"
                  onClick={() => downloadFile(f)}
                  className="hover:text-primary truncate text-left font-medium underline-offset-2 hover:underline"
                >
                  {f.name}
                </button>
              );
              if (!isImage(f.mimeType)) return trigger;
              return (
                <HoverCard>
                  <HoverCardTrigger render={trigger} />
                  <HoverCardContent className="w-auto p-1">
                    <img
                      src={`/api/files/${f.id}`}
                      alt={f.name}
                      loading="lazy"
                      className="max-h-48 max-w-64 rounded object-contain"
                    />
                  </HoverCardContent>
                </HoverCard>
              );
            },
          },
          user: {
            label: tr("admin.files.colUser", { default: "Uploaded by" }),
            cell: (f) => {
              const label =
                f.user?.email ||
                f.user?.username ||
                [f.user?.firstName, f.user?.lastName]
                  .filter(Boolean)
                  .join(" ") ||
                f.creatorName ||
                null;
              return label ? (
                <span className="truncate">{label}</span>
              ) : (
                <span className="text-muted-foreground font-mono text-xs">
                  {f.creator?.slice(0, 8) ?? "—"}
                </span>
              );
            },
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
              <span
                className="text-muted-foreground text-xs"
                title={String(l(f.createdAt, { date: "lll" }))}
              >
                {String(l(f.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
        }}
        rowActions={(f) => [
          {
            label: tr("admin.files.download", { default: "Download" }),
            icon: Download,
            onClick: () => downloadFile(f),
          },
          {
            label: tr("admin.files.delete", { default: "Delete" }),
            icon: Trash2,
            destructive: true,
            onClick: (_f, { refresh }) => handleDelete(f, refresh),
          },
        ]}
      />
    </div>
  );
}
