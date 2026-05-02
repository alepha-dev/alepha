import { AlephaTable } from "@alepha/ui/components/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useDialog } from "@alepha/ui/components/use-dialog";
import type { Page } from "alepha";
import type { AdminApiKeyController } from "alepha/api/keys";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export function AdminKeys() {
  const client = useClient<AdminApiKeyController>();
  const dialog = useDialog();
  const { l, tr } = useI18n();
  const [refreshKey, setRefreshKey] = useState(0);

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.findApiKeys({ query: params as never });
      return res as Page<any>;
    },
    [client, refreshKey],
  );

  const handleRevoke = async (k: any) => {
    const ok = await dialog.confirm({
      title: tr("admin.keys.revokeTitle", { default: "Revoke API key" }),
      description: tr("admin.keys.revokeConfirm", {
        default: `Revoke "${k.name}"? Any apps using this key will lose access.`,
        args: [k.name],
      }),
      destructive: true,
    });
    if (!ok) return;
    await client.revokeApiKey({ params: { id: k.id } });
    toast.success(tr("admin.keys.revoked", { default: "API key revoked" }));
    setRefreshKey((rk) => rk + 1);
  };

  return (
    <div className="p-6">
      <AlephaTable
        fetch={fetcher}
        header={
          <div>
            <h1 className="text-lg font-semibold">
              {tr("admin.keys.title", { default: "API keys" })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {tr("admin.keys.subtitle", {
                default: "Programmatic access tokens.",
              })}
            </p>
          </div>
        }
        columns={{
          name: {
            label: tr("admin.keys.colName", { default: "Name" }),
            cell: (k) => <span className="font-medium">{k.name}</span>,
          },
          prefix: {
            label: tr("admin.keys.colPrefix", { default: "Prefix" }),
            cell: (k) => <code className="text-xs">{k.prefix ?? "—"}</code>,
          },
          owner: {
            label: tr("admin.keys.colOwner", { default: "Owner" }),
            cell: (k) => <span className="text-sm">{k.userId ?? "—"}</span>,
          },
          scopes: {
            label: tr("admin.keys.colScopes", { default: "Scopes" }),
            cell: (k) =>
              Array.isArray(k.scopes) && k.scopes.length ? (
                <div className="flex flex-wrap gap-1">
                  {k.scopes.map((s: string) => (
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
            onClick: () => handleRevoke(k),
          },
        ]}
      />
    </div>
  );
}
