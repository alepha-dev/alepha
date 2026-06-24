import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type {
  AdminApiKeyController,
  AdminApiKeyResource,
} from "alepha/api/keys";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";
import { useCallback } from "react";

export function AdminKeys() {
  const client = useClient<AdminApiKeyController>();
  const toast = useToast();
  const dialog = useDialog();
  const { l, tr } = useI18n();

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      return client.findApiKeys({ query: params });
    },
    [client],
  );

  const revoke = useConfirmedAction<[AdminApiKeyResource, () => void]>(
    {
      confirm: (k) => ({
        title: tr("admin.keys.revokeTitle", { default: "Revoke API key" }),
        description: tr("admin.keys.revokeConfirm", {
          default: `Revoke "${k.name}"? Any apps using this key will lose access.`,
          args: [k.name],
        }),
        destructive: true,
      }),
      handler: async (k, refresh) => {
        await client.revokeApiKey({ params: { id: k.id } });
        refresh();
      },
      success: tr("admin.keys.revoked", { default: "API key revoked" }),
    },
    [client, tr],
  );

  const bulkRevoke = useAction<
    [AdminApiKeyResource[], { clearSelection: () => void; refresh: () => void }]
  >(
    {
      handler: async (items, ctx) => {
        const targets = items.filter((k) => !k.revokedAt);
        if (targets.length === 0) {
          toast.error(
            tr("admin.keys.noneSelected", {
              default: "No active API keys in selection",
            }),
          );
          return;
        }
        const ok = await dialog.confirm({
          title: tr("admin.keys.bulkRevokeTitle", {
            default: "Revoke API keys",
          }),
          description: tr("admin.keys.bulkRevokeConfirm", {
            default: `Revoke ${targets.length} API key(s)? Any apps using these keys will lose access.`,
            args: [String(targets.length)],
          }),
          destructive: true,
        });
        if (!ok) return;
        const res = await client.revokeApiKeys({
          body: { ids: targets.map((k) => k.id) },
        });
        toast.success(
          tr("admin.keys.bulkRevoked", {
            default: `${res.revoked.length} API key(s) revoked`,
            args: [String(res.revoked.length)],
          }),
        );
        ctx.clearSelection();
        ctx.refresh();
      },
    },
    [client, dialog, toast, tr],
  );

  return (
    <AdminPage>
      <AlephaTable<AdminApiKeyResource>
        className="min-h-0 flex-1"
        persistenceKey="admin.keys"
        fetch={fetcher}
        bulkActions={[
          {
            label: tr("admin.keys.bulkRevoke", {
              default: "Revoke selected",
            }),
            icon: Trash2,
            destructive: true,
            onClick: (items, ctx) => bulkRevoke.run(items, ctx),
          },
        ]}
        columns={{
          name: {
            label: tr("admin.keys.colName", { default: "Name" }),
            cell: (k) => <span className="font-medium">{k.name}</span>,
          },
          tokenPrefix: {
            label: tr("admin.keys.colPrefix", { default: "Prefix" }),
            cell: (k) => (
              <code className="text-xs">{k.tokenPrefix ?? "—"}</code>
            ),
          },
          owner: {
            label: tr("admin.keys.colOwner", { default: "Owner" }),
            cell: (k) => <span className="text-sm">{k.userId ?? "—"}</span>,
          },
          roles: {
            label: tr("admin.keys.colScopes", { default: "Roles" }),
            cell: (k) =>
              Array.isArray(k.roles) && k.roles.length ? (
                <div className="flex flex-wrap gap-1">
                  {k.roles.map((s: string) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              ),
          },
          createdAt: {
            label: tr("admin.keys.colCreated", { default: "Created" }),
            sortable: true,
            cell: (k) => (
              <span className="text-muted-foreground text-xs">
                {String(l(k.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
        }}
        rowActions={(k) => [
          {
            label: tr("admin.keys.revoke", { default: "Revoke" }),
            icon: Trash2,
            destructive: true,
            onClick: (_k, { refresh }) => revoke.run(k, refresh),
          },
        ]}
      />
    </AdminPage>
  );
}

export default AdminKeys;
