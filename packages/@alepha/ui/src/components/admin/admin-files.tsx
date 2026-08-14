import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { AdminUserCell } from "@alepha/ui/components/admin/admin-user-cell";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@alepha/ui/components/ui/hover-card";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Infer, z } from "alepha";
import type {
  AdminFileStatsController,
  FileController,
  FileResource,
} from "alepha/api/files";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Container, Download, Search, Trash2, Upload } from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  useMemo,
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
const filtersSchema = z.object({
  name: z.string().optional(),
  bucket: z.string().optional(),
});
type AdminFileFilters = Infer<typeof filtersSchema>;

const isImage = (mimeType?: string) => Boolean(mimeType?.startsWith("image/"));

export function AdminFiles() {
  const client = useClient<FileController>();
  const statsClient = useClient<AdminFileStatsController>();
  const { l, tr } = useI18n();
  const toast = useToast();
  // Bumped after a successful upload to reload the bucket-stats query (which
  // lists it in its deps) and the table (via AlephaTable's `refreshSignal`
  // prop). Row/bulk actions reload via the table's own ctx.refresh() and
  // don't touch this.
  const [refreshKey, setRefreshKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Populate the bucket filter from storage stats. Re-runs after uploads so
  // counts (and any newly-created bucket) stay current. If stats can't be
  // fetched the filter degrades to empty.
  const { data: stats } = useQuery(
    {
      handler: ({ signal }) =>
        statsClient.getFileStats({} as never, { request: { signal } }),
      onError: () => {},
    },
    [statsClient, refreshKey],
  );
  const bucketItems = useMemo(
    () =>
      (stats?.byBucket ?? []).map((b) => ({
        value: b.bucket,
        label: `${b.bucket} (${b.fileCount})`,
      })),
    [stats],
  );

  const downloadFile = useCallback((f: FileResource) => {
    window.open(`/api/files/${f.id}`, "_blank");
  }, []);

  const upload = useAction<[ChangeEvent<HTMLInputElement>], void>(
    {
      handler: async (e) => {
        const file = e.target.files?.[0];
        // Reset so the same file can be re-selected on a subsequent click,
        // regardless of whether the upload succeeds.
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (!file) return;
        await client.uploadFile({ body: { file } });
        toast.success(
          tr("admin.files.uploaded", {
            default: `Uploaded ${file.name}`,
            args: [file.name],
          }),
        );
        setRefreshKey((k) => k + 1);
      },
    },
    [client, toast, tr],
  );

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: AdminFileFilters;
    }) => {
      return client.findFiles({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          name: params.filters?.name || undefined,
          bucket: params.filters?.bucket || undefined,
        },
      });
    },
    [client],
  );

  const deleteFile = useConfirmedAction<[FileResource, () => void]>(
    {
      confirm: (file) => ({
        title: tr("admin.files.deleteTitle", { default: "Delete file" }),
        description: tr("admin.files.deleteConfirm", {
          default: `Permanently delete "${file.name}"?`,
          args: [file.name],
        }),
        destructive: true,
      }),
      handler: async (file, refresh) => {
        await client.deleteFile({ params: { id: file.id } });
        refresh();
      },
      success: tr("admin.files.deleted", { default: "File deleted" }),
    },
    [client, tr],
  );

  const bulkDelete = useConfirmedAction<
    [FileResource[], { clearSelection: () => void; refresh: () => void }]
  >(
    {
      confirm: (items) => ({
        title: tr("admin.files.bulkDeleteTitle", { default: "Delete files" }),
        description: tr("admin.files.bulkDeleteConfirm", {
          default: `Permanently delete ${items.length} file(s)? This cannot be undone.`,
          args: [String(items.length)],
        }),
        destructive: true,
      }),
      handler: async (items, { clearSelection, refresh }) => {
        if (items.length === 0) return;
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
      },
    },
    [client, toast, tr],
  );

  return (
    <AdminPage>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => upload.run(e)}
      />
      <AlephaTable<FileResource>
        className="min-h-0 flex-1"
        persistenceKey="admin.files"
        fetch={fetcher}
        refreshSignal={refreshKey}
        actions={[
          {
            icon: Upload,
            label: upload.loading
              ? tr("admin.files.uploading", { default: "Uploading…" })
              : tr("admin.files.upload", { default: "Upload" }),
            disabled: upload.loading,
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
                icon={Container}
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
            onClick: (items, ctx) => bulkDelete.run(items, ctx),
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
            cell: (f) => (
              <AdminUserCell
                userId={f.creator}
                user={f.user}
                fallbackLabel={f.creatorName}
              />
            ),
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
            onClick: (_f, { refresh }) => deleteFile.run(f, refresh),
          },
        ]}
      />
    </AdminPage>
  );
}

export default AdminFiles;
