import { AlephaTable } from "@alepha/ui/components/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useConfirm } from "@alepha/ui/components/use-confirm";
import type { Page } from "alepha";
import type { AdminParameterController } from "alepha/api/parameters";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

/**
 * Simplified parameters admin — list view only. The full Mantine version
 * has a tree view + history pane + per-key form; port those as separate
 * blocks if needed.
 */
export function AdminParameters() {
  const client = useClient<AdminParameterController>();
  const confirm = useConfirm();
  const { l } = useI18n();
  const [refreshKey, setRefreshKey] = useState(0);

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
    [client, refreshKey],
  );

  const handleDelete = async (p: any) => {
    const ok = await confirm({
      title: "Delete parameter",
      description: `Delete "${p.name}"? Apps reading this key will fall back to defaults.`,
      destructive: true,
    });
    if (!ok) return;
    await client.deleteParameter({ params: { name: p.name } });
    toast.success("Parameter deleted");
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="p-6">
      <AlephaTable
        fetch={fetcher}
        header={
          <div>
            <h1 className="text-lg font-semibold">Parameters</h1>
            <p className="text-muted-foreground text-sm">
              Runtime configuration values.
            </p>
          </div>
        }
        columns={{
          key: {
            label: "Name",
            cell: (p) => <code className="text-sm font-medium">{p.name}</code>,
          },
          value: {
            label: "Value",
            cell: (p) => (
              <code className="text-muted-foreground line-clamp-1 text-xs">
                {typeof p.value === "string"
                  ? p.value
                  : JSON.stringify(p.value)}
              </code>
            ),
          },
          type: {
            label: "Type",
            cell: (p) => (
              <Badge variant="secondary">{p.type ?? "string"}</Badge>
            ),
          },
          updatedAt: {
            label: "Updated",
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
            label: "Delete",
            icon: Trash2,
            destructive: true,
            onClick: () => handleDelete(p),
          },
        ]}
      />
    </div>
  );
}
