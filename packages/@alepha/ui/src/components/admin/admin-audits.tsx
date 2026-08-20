import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { AdminUserCell } from "@alepha/ui/components/admin/admin-user-cell";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Infer, z } from "alepha";
import type { AdminAuditController, AuditEntity } from "alepha/api/audits";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { CircleDot, SlidersHorizontal, Trash2, User, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const auditFiltersSchema = z.object({
  status: z.string().optional(),
  action: z.string().optional(),
});
type AuditFilters = Infer<typeof auditFiltersSchema>;

export function AdminAudits() {
  const client = useClient<AdminAuditController>();
  const toast = useToast();
  const router = useRouter();
  const { l, tr } = useI18n();

  const [actions, setActions] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    client
      .getAuditActions()
      .then((rows) => {
        if (!alive) return;
        setActions(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client]);

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: AuditFilters;
    }) => {
      const f = params.filters;
      return client.findAudits({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          action: f?.action || undefined,
          success: f?.status ? f.status === "ok" : undefined,
        },
      });
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
          default: `Delete ${items.length} audit record(s)? Audit logs are usually retained for compliance. This cannot be undone.`,
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

  // A resource rendered as an icon + label that links to its admin page.
  const resourceLink = (href: string, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      title={label}
      onClick={() => router.push(href as never)}
      className="hover:text-primary inline-flex items-center gap-1.5 truncate text-left text-xs underline-offset-2 hover:underline"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
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
        filters={{
          schema: auditFiltersSchema,
          render: (form) => (
            <div className="flex items-center gap-2">
              <Control
                input={form.input.status}
                label=""
                clearable
                icon={CircleDot}
                clearLabel={String(
                  tr("admin.audits.statusAll", { default: "All status" }),
                )}
                triggerClassName="w-40"
                items={[
                  {
                    value: "ok",
                    label: tr("admin.audits.ok", { default: "OK" }),
                  },
                  {
                    value: "failed",
                    label: String(
                      tr("admin.audits.failed", { default: "Failed" }),
                    ),
                  },
                ]}
              />
              <Control
                input={form.input.action}
                label=""
                clearable
                icon={Zap}
                clearLabel={String(
                  tr("admin.audits.actionAll", { default: "All actions" }),
                )}
                triggerClassName="w-48"
                items={actions.map((action) => ({
                  value: action,
                  label: action,
                }))}
              />
            </div>
          ),
        }}
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
              <code className="text-xs font-medium">
                {a.type}:{a.action}
              </code>
            ),
          },
          resource: {
            label: tr("admin.audits.colResource", { default: "Resource" }),
            cell: (a) => {
              if (a.resourceType === "parameter" && a.resourceId) {
                return resourceLink(
                  `/admin/parameters?param=${encodeURIComponent(a.resourceId)}`,
                  <SlidersHorizontal className="size-3.5 shrink-0" />,
                  a.resourceId,
                );
              }
              if (a.resourceType === "user" && a.resourceId) {
                return resourceLink(
                  `/admin/users/${a.resourceId}`,
                  <User className="size-3.5 shrink-0" />,
                  a.resourceId,
                );
              }
              return (
                <span className="font-mono text-xs">
                  {a.resourceType
                    ? `${a.resourceType}:${a.resourceId ?? "—"}`
                    : "—"}
                </span>
              );
            },
          },
          actor: {
            label: tr("admin.audits.colActor", { default: "Actor" }),
            /*
             * Audit rows carry a write-time `userEmail` snapshot rather than
             * a live join — the actor's address as it was when the action
             * happened is itself audit data.
             */
            cell: (a) => (
              <AdminUserCell userId={a.userId} fallbackLabel={a.userEmail} />
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

export default AdminAudits;
