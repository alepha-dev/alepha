import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import type { Page } from "alepha";
import type { AdminAuditController, AuditEntity } from "alepha/api/audits";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export function AdminAudits() {
  const client = useClient<AdminAuditController>();
  const dialog = useDialog();
  const { l, tr } = useI18n();
  const [refreshKey, setRefreshKey] = useState(0);

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.findAudits({ query: params as never });
      return res as Page<AuditEntity>;
    },
    [client, refreshKey],
  );

  const handleBulkDelete = async (items: AuditEntity[], clear: () => void) => {
    if (items.length === 0) return;
    const ok = await dialog.confirm({
      title: tr("admin.audits.bulkDeleteTitle", {
        default: "Delete audit entries",
      }),
      description: tr("admin.audits.bulkDeleteConfirm", {
        default: `Delete ${items.length} audit record(s)? Audit logs are usually retained for compliance — this cannot be undone.`,
        args: [String(items.length)],
      }),
      destructive: true,
    });
    if (!ok) return;
    const res = await client.deleteAudits({
      body: { ids: items.map((a) => a.id) },
    });
    toast.success(
      tr("admin.audits.bulkDeleted", {
        default: `${res.deleted.length} audit(s) deleted`,
        args: [String(res.deleted.length)],
      }),
    );
    clear();
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="p-6">
      <AlephaTable<AuditEntity>
        fetch={fetcher}
        bulkActions={[
          {
            label: tr("admin.audits.bulkDelete", {
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
              {tr("admin.audits.title", { default: "Audit log" })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr("admin.audits.subtitle", {
                default:
                  "Read-only history of API actions and resource changes.",
              })}
            </p>
          </div>
        }
        columns={{
          createdAt: {
            label: tr("admin.audits.colWhen", { default: "When" }),
            sortable: true,
            cell: (a) => (
              <span className="text-muted-foreground text-xs">
                {String(l(a.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          action: {
            label: tr("admin.audits.colAction", { default: "Action" }),
            cell: (a) => (
              <code className="text-xs font-medium">{a.action}</code>
            ),
          },
          resource: {
            label: tr("admin.audits.colResource", { default: "Resource" }),
            cell: (a) => (
              <span className="font-mono text-xs">
                {a.resourceType
                  ? `${a.resourceType}:${a.resourceId ?? "—"}`
                  : "—"}
              </span>
            ),
          },
          actor: {
            label: tr("admin.audits.colActor", { default: "Actor" }),
            cell: (a) => (
              <span className="text-sm">
                {(a as any).userEmail ?? (a as any).userId ?? "—"}
              </span>
            ),
          },
          status: {
            label: tr("admin.audits.colStatus", { default: "Status" }),
            cell: (a) => (
              <Badge variant={a.success ? "default" : "destructive"}>
                {a.success
                  ? tr("admin.audits.ok", { default: "OK" })
                  : tr("admin.audits.failed", { default: "Failed" })}
              </Badge>
            ),
          },
        }}
      />
    </div>
  );
}
