import type { Page } from "alepha";
import type { AdminSessionController, SessionEntity } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { LogOut } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { AlephaTable } from "@/registry/default/alepha-table/alepha-table";
import { useDialog } from "@/registry/default/use-dialog/use-dialog";

export function AdminSessions() {
  const client = useClient<AdminSessionController>();
  const dialog = useDialog();
  const { l } = useI18n();
  const [refreshKey, setRefreshKey] = useState(0);

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.findSessions({ query: params as never });
      return res as Page<SessionEntity>;
    },
    [client, refreshKey],
  );

  const handleRevoke = async (s: SessionEntity) => {
    const ok = await dialog.confirm({
      title: "Revoke session",
      description: "The user will be signed out from this session.",
      destructive: true,
    });
    if (!ok) return;
    await client.deleteSession({ params: { id: s.id } });
    toast.success("Session revoked");
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="p-6">
      <AlephaTable<SessionEntity>
        fetch={fetcher}
        header={
          <div>
            <h1 className="text-lg font-semibold">Sessions</h1>
            <p className="text-muted-foreground text-sm">
              Active user sessions.
            </p>
          </div>
        }
        columns={{
          user: {
            label: "User",
            cell: (s) => (
              <span className="font-medium">{(s as any).userId ?? "—"}</span>
            ),
          },
          ip: {
            label: "IP",
            cell: (s) => (
              <code className="text-xs">{(s as any).ip ?? "—"}</code>
            ),
          },
          userAgent: {
            label: "Device",
            cell: (s) => (
              <span className="text-muted-foreground line-clamp-1 text-xs">
                {(s as any).userAgent ?? "—"}
              </span>
            ),
          },
          createdAt: {
            label: "Started",
            sortable: true,
            cell: (s) => (
              <span className="text-muted-foreground text-xs">
                {String(l(s.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          status: {
            label: "Status",
            cell: (s) => (
              <Badge variant={(s as any).revokedAt ? "outline" : "default"}>
                {(s as any).revokedAt ? "Revoked" : "Active"}
              </Badge>
            ),
          },
        }}
        rowActions={(s) =>
          (s as any).revokedAt
            ? []
            : [
                {
                  label: "Revoke",
                  icon: LogOut,
                  destructive: true,
                  onClick: () => handleRevoke(s),
                },
              ]
        }
      />
    </div>
  );
}
