import * as React from "react";

import TimeAgo from "../core/TimeAgo.tsx";

void React;

import { type Infer, z } from "alepha";
import type {
  AdminApiKeyController,
  AdminApiKeyResource,
  ApiKeyController,
  ApiKeyStatus,
  ListApiKeyItem,
} from "alepha/api/keys";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { CircleDot, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import { ApiKeyCreateDialog } from "../account/ApiKeyCreateDialog.tsx";
import { ApiKeyScopeSummary } from "../account/ApiKeyScopeSummary.tsx";
import { ApiKeyStatusBadge } from "../account/ApiKeyStatusBadge.tsx";
import { Badge } from "../core/Badge.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { Control } from "../form/Control.tsx";
import { AlephaTable } from "../table/AlephaTable.tsx";
import { AdminKeysTokenDialog } from "./AdminKeysTokenDialog.tsx";
import { AdminPage } from "./AdminPage.tsx";
import { AdminUserCell } from "./AdminUserCell.tsx";
import { useConfirmedAction } from "./useConfirmedAction.tsx";

// Filter schema at module scope so its identity stays stable across renders:
// AlephaTable's internal `useForm` captures it once.
const keyFiltersSchema = z.object({
  status: z
    .array(z.enum(["active", "expiring", "expired", "revoked"]))
    .optional(),
});
type AdminKeyFilters = Infer<typeof keyFiltersSchema>;

export const AdminKeys = () => {
  const client = useClient<AdminApiKeyController>();
  const userClient = useClient<ApiKeyController>();
  const toast = useToast();
  const dialog = useDialog();
  const { tr } = useI18n();
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [ownKeys, setOwnKeys] = useState<ListApiKeyItem[]>([]);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: AdminKeyFilters;
    }) => {
      const status = params.filters?.status;
      return client.findApiKeys({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          // An empty selection is no filter at all, which the server reads
          // as "everything but revoked".
          ...(status?.length ? { status } : {}),
        },
      });
    },
    [client],
  );

  const statusLabel = (status: ApiKeyStatus): string => {
    switch (status) {
      case "active":
        return tr("account.keys.status.active", { default: "Active" });
      case "expiring":
        return tr("account.keys.status.expiringLabel", { default: "Expiring" });
      case "expired":
        return tr("account.keys.status.expired", { default: "Expired" });
      case "revoked":
        return tr("account.keys.status.revoked", { default: "Revoked" });
    }
  };

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
        refreshSignal={refreshSignal}
        actions={[
          {
            icon: Plus,
            label: tr("admin.keys.create", { default: "Add API key" }),
            // The page's one create control.
            primary: true,
            onClick: async () => {
              // The key is the admin's own, so the names it may not take are
              // the admin's own keys, not the ones in this table. Without the
              // list the server still refuses a clash, in blunter words.
              try {
                setOwnKeys(await userClient.listApiKeys());
              } catch {
                setOwnKeys([]);
              }
              setCreateOpen(true);
            },
          },
        ]}
        filters={{
          schema: keyFiltersSchema,
          // Today's default, spelled out: every key but the revoked ones.
          initialValues: { status: ["active", "expiring", "expired"] },
          render: (form) => (
            <div className="flex flex-wrap items-center gap-2">
              <Control
                input={form.input.status}
                label=""
                icon={CircleDot}
                triggerClassName="w-64"
                clearLabel={tr("admin.keys.statusAll", {
                  default: "All statuses",
                })}
                items={(
                  ["active", "expiring", "expired", "revoked"] as const
                ).map((status) => ({
                  value: status,
                  label: statusLabel(status),
                }))}
              />
            </div>
          ),
        }}
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
            cell: (k) => <AdminUserCell userId={k.userId} user={k.user} />,
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
          permissions: {
            label: tr("admin.keys.colPermissions", { default: "Scope" }),
            cell: (k) => <ApiKeyScopeSummary permissions={k.permissions} />,
          },
          ipAllowlist: {
            label: tr("admin.keys.colIpAllowlist", { default: "Allowed from" }),
            // Read-only: an allowlist is set through the API at creation and
            // cannot be edited, only seen, so a refused key can be diagnosed.
            cell: (k) =>
              k.ipAllowlist.length ? (
                <div className="flex flex-col gap-0.5">
                  {k.ipAllowlist.map((entry) => (
                    <code key={entry} className="text-xs">
                      {entry}
                    </code>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("admin.keys.ipAnywhere", { default: "Anywhere" })}
                </span>
              ),
          },
          status: {
            label: tr("admin.keys.colStatus", { default: "Status" }),
            // The Expires column beside it carries the date.
            cell: (k) => <ApiKeyStatusBadge apiKey={k} labelOnly />,
          },
          expiresAt: {
            label: tr("admin.keys.colExpires", { default: "Expires" }),
            sortable: true,
            cell: (k) =>
              k.expiresAt ? (
                <TimeAgo
                  value={k.expiresAt}
                  className="text-muted-foreground text-xs"
                />
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("admin.keys.noExpiry", { default: "Never" })}
                </span>
              ),
          },
          createdAt: {
            label: tr("admin.keys.colCreated", { default: "Created" }),
            sortable: true,
            cell: (k) => (
              <TimeAgo
                value={k.createdAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
        }}
        // Revoke only: no rotate here. Rotating another user's key would mint
        // a credential that authenticates as them and hand its secret to the
        // admin, which is strictly more than revocation (#Q2056).
        rowActions={(k) =>
          k.revokedAt
            ? []
            : [
                {
                  label: tr("admin.keys.revoke", { default: "Revoke" }),
                  icon: Trash2,
                  destructive: true,
                  onClick: (_k, { refresh }) => revoke.run(k, refresh),
                },
              ]
        }
      />
      <ApiKeyCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingKeys={ownKeys}
        // The admin mints for nobody but themselves: the same endpoint the
        // account panel calls, and the copy says so.
        ownershipNote={tr("admin.keys.createDescription", {
          default:
            "The key is created for your account and carries your current roles.",
        })}
        onCreated={(token) => {
          setCreatedToken(token);
          setRefreshSignal((n) => n + 1);
        }}
      />
      <AdminKeysTokenDialog
        token={createdToken}
        onClose={() => setCreatedToken(null)}
      />
    </AdminPage>
  );
};

export default AdminKeys;
