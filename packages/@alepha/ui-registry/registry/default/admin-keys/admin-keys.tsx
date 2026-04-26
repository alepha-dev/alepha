import type { Page } from "alepha";
import type { AdminApiKeyController } from "alepha/api/keys";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { AlephaTable } from "@/registry/default/alepha-table/alepha-table";
import { useConfirm } from "@/registry/default/use-confirm/use-confirm";

export function AdminKeys() {
  const client = useClient<AdminApiKeyController>();
  const confirm = useConfirm();
  const { l } = useI18n();
  const [refreshKey, setRefreshKey] = useState(0);

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.findApiKeys({ query: params as never });
      return res as Page<any>;
    },
    [client, refreshKey],
  );

  const handleRevoke = async (k: any) => {
    const ok = await confirm({
      title: "Revoke API key",
      description: `Revoke "${k.name}"? Any apps using this key will lose access.`,
      destructive: true,
    });
    if (!ok) return;
    await client.revokeApiKey({ params: { id: k.id } });
    toast.success("API key revoked");
    setRefreshKey((rk) => rk + 1);
  };

  return (
    <div className="p-6">
      <AlephaTable
        fetch={fetcher}
        header={
          <div>
            <h1 className="text-lg font-semibold">API keys</h1>
            <p className="text-muted-foreground text-sm">
              Programmatic access tokens.
            </p>
          </div>
        }
        columns={{
          name: {
            label: "Name",
            cell: (k) => <span className="font-medium">{k.name}</span>,
          },
          prefix: {
            label: "Prefix",
            cell: (k) => <code className="text-xs">{k.prefix ?? "—"}</code>,
          },
          owner: {
            label: "Owner",
            cell: (k) => <span className="text-sm">{k.userId ?? "—"}</span>,
          },
          scopes: {
            label: "Scopes",
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
            label: "Created",
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
            label: "Revoke",
            icon: Trash2,
            destructive: true,
            onClick: () => handleRevoke(k),
          },
        ]}
      />
    </div>
  );
}
