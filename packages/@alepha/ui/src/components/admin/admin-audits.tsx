import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { PageHeader } from "@alepha/ui/components/admin/page-header";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { AdminAuditController, AuditEntity } from "alepha/api/audits";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";
import { useCallback } from "react";

export function AdminAudits() {
  const client = useClient<AdminAuditController>();
  const toast = useToast();
  const { l, tr } = useI18n();

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      return client.findAudits({ query: params });
    },
    [client],
  );

  const bulkDelete = useConfirmedAction<
    [AuditEntity[], { clearSelection: () => void; refresh: () => void }]
  >(
    {
      confirm: (items) => ({
        title: tr("admin.audits.bulkDeleteTitle", {
          default: "Delete audit entries",
        }),
        description: tr("admin.audits.bulkDeleteConfirm", {
          default: `Delete ${items.length} audit record(s)? Audit logs are usually retained for compliance — this cannot be undone.`,
          args: [String(items.length)],
        }),
        destructive: true,
      }),
      handler: async (items, ctx) => {
        if (items.length === 0) return;
        const res = await client.deleteAudits({
          body: { ids: items.map((a) => a.id) },
        });
        toast.success(
          tr("admin.audits.bulkDeleted", {
            default: `${res.deleted.length} audit(s) deleted`,
            args: [String(res.deleted.length)],
          }),
        );
        ctx.clearSelection();
        ctx.refresh();
      },
    },
    [client, toast, tr],
  );

  return (
    <AdminPage>
      <AlephaTable<AuditEntity>
        className="min-h-0 flex-1"
        persistenceKey="admin.audits"
        fetch={fetcher}
        bulkActions={[
          {
            label: tr("admin.audits.bulkDelete", {
              default: "Delete selected",
            }),
            icon: Trash2,
            destructive: true,
            onClick: (items, ctx) => bulkDelete.run(items, ctx),
          },
        ]}
        header={
          <PageHeader
            title={tr("admin.audits.title", { default: "Audit log" })}
            description={tr("admin.audits.subtitle", {
              default: "Read-only history of API actions and resource changes.",
            })}
          />
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
              <span className="text-sm">{a.userEmail ?? a.userId ?? "—"}</span>
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
    </AdminPage>
  );
}
