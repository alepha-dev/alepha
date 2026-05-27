import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import type { Page } from "alepha";
import type { AdminParameterController } from "alepha/api/parameters";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";

/**
 * Simplified parameters admin — list view only. The full Mantine version
 * has a tree view + history pane + per-key form; port those as separate
 * blocks if needed.
 */
export function AdminParameters() {
  const client = useClient<AdminParameterController>();
  const dialog = useDialog();
  const { l, tr } = useI18n();

  const fetcher = useCallback(
    async (_params: { page: number; size: number; sort?: string }) => {
      // Parameter API is non-paginated tree; flatten to a fake Page<T> for table compat.
      const { names } = await client.listParameterNames();
      const items = await Promise.all(
        names.map(async (name) => {
          const cur = await client.getCurrent({ params: { name } });
          return { name, ...(cur as Record<string, unknown>) };
        }),
      );
      return {
        content: items,
        page: {
          number: 0,
          size: items.length,
          offset: 0,
          numberOfElements: items.length,
          totalElements: items.length,
          totalPages: 1,
          isEmpty: items.length === 0,
          isFirst: true,
          isLast: true,
        },
      } as Page<any>;
    },
    [client],
  );

  const handleDelete = async (p: any, refresh: () => void) => {
    const ok = await dialog.confirm({
      title: tr("admin.parameters.deleteTitle", {
        default: "Delete parameter",
      }),
      description: tr("admin.parameters.deleteConfirm", {
        default: `Delete "${p.name}"? Apps reading this key will fall back to defaults.`,
        args: [p.name],
      }),
      destructive: true,
    });
    if (!ok) return;
    await client.deleteParameter({ params: { name: p.name } });
    toast.success(
      tr("admin.parameters.deleted", { default: "Parameter deleted" }),
    );
    refresh();
  };

  const handleBulkDelete = async (
    items: any[],
    { clearSelection, refresh }: { clearSelection: () => void; refresh: () => void },
  ) => {
    if (items.length === 0) return;
    const ok = await dialog.confirm({
      title: tr("admin.parameters.bulkDeleteTitle", {
        default: "Delete parameters",
      }),
      description: tr("admin.parameters.bulkDeleteConfirm", {
        default: `Delete ${items.length} parameter(s)? Apps reading these keys will fall back to defaults.`,
        args: [String(items.length)],
      }),
      destructive: true,
    });
    if (!ok) return;
    const res = await client.deleteParameters({
      body: { names: items.map((p) => p.name) },
    });
    toast.success(
      tr("admin.parameters.bulkDeleted", {
        default: `${res.deleted.length} parameter(s) deleted`,
        args: [String(res.deleted.length)],
      }),
    );
    clearSelection();
    refresh();
  };

  return (
    <div className="p-6">
      <AlephaTable
        fetch={fetcher}
        rowKey={(p: any) => p.name}
        bulkActions={[
          {
            label: tr("admin.parameters.bulkDelete", {
              default: "Delete selected",
            }),
            icon: Trash2,
            destructive: true,
            onClick: handleBulkDelete,
          },
        ]}
        header={
          <div>
            <h1 className="text-lg font-semibold">
              {tr("admin.parameters.title", { default: "Parameters" })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr("admin.parameters.subtitle", {
                default: "Runtime configuration values.",
              })}
            </p>
          </div>
        }
        columns={{
          key: {
            label: tr("admin.parameters.colName", { default: "Name" }),
            cell: (p) => <code className="text-sm font-medium">{p.name}</code>,
          },
          value: {
            label: tr("admin.parameters.colValue", { default: "Value" }),
            cell: (p) => (
              <code className="text-muted-foreground line-clamp-1 text-xs">
                {typeof p.value === "string"
                  ? p.value
                  : JSON.stringify(p.value)}
              </code>
            ),
          },
          type: {
            label: tr("admin.parameters.colType", { default: "Type" }),
            cell: (p) => (
              <Badge variant="secondary">{p.type ?? "string"}</Badge>
            ),
          },
          updatedAt: {
            label: tr("admin.parameters.colUpdated", { default: "Updated" }),
            sortable: true,
            cell: (p) => (
              <span className="text-muted-foreground text-xs">
                {String(l(p.updatedAt, { date: "fromNow" }))}
              </span>
            ),
          },
        }}
        rowActions={(p) => [
          {
            label: tr("admin.parameters.delete", { default: "Delete" }),
            icon: Trash2,
            destructive: true,
            onClick: (_p, { refresh }) => handleDelete(p, refresh),
          },
        ]}
      />
    </div>
  );
}
