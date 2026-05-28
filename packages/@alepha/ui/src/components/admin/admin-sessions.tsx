import * as React from "react";

void React;

import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { Page } from "alepha";
import type { AdminSessionController, SessionResource } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { LogOut } from "lucide-react";
import { useCallback } from "react";

export function AdminSessions() {
  const client = useClient<AdminSessionController>();
  const toast = useToast();
  const dialog = useDialog();
  const { l, tr } = useI18n();

  const fetcher = useCallback(
    async (params: { page: number; size: number; sort?: string }) => {
      const res = await client.findSessions({ query: params as never });
      return res as Page<SessionResource>;
    },
    [client],
  );

  const handleRevoke = async (s: SessionResource, refresh: () => void) => {
    const ok = await dialog.confirm({
      title: tr("admin.sessions.revokeTitle", { default: "Revoke session" }),
      description: tr("admin.sessions.revokeConfirm", {
        default: "The user will be signed out from this session.",
      }),
      destructive: true,
    });
    if (!ok) return;
    await client.deleteSession({ params: { id: s.id } });
    toast.success(tr("admin.sessions.revoked", { default: "Session revoked" }));
    refresh();
  };

  const handleBulkRevoke = async (
    items: SessionResource[],
    {
      clearSelection,
      refresh,
    }: { clearSelection: () => void; refresh: () => void },
  ) => {
    const targets = items.filter((s) => !(s as any).revokedAt);
    if (targets.length === 0) {
      toast.error(
        tr("admin.sessions.noneSelected", {
          default: "No active sessions in selection",
        }),
      );
      return;
    }
    const ok = await dialog.confirm({
      title: tr("admin.sessions.bulkRevokeTitle", {
        default: "Revoke sessions",
      }),
      description: tr("admin.sessions.bulkRevokeConfirm", {
        default: `Revoke ${targets.length} session(s)? Affected users will be signed out.`,
        args: [String(targets.length)],
      }),
      destructive: true,
    });
    if (!ok) return;
    const res = await client.deleteSessions({
      body: { ids: targets.map((s) => s.id) },
    });
    toast.success(
      tr("admin.sessions.bulkRevoked", {
        default: `${res.deleted.length} session(s) revoked`,
        args: [String(res.deleted.length)],
      }),
    );
    clearSelection();
    refresh();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <AlephaTable<SessionResource>
        className="min-h-0 flex-1"
        persistenceKey="admin.sessions"
        fetch={fetcher}
        bulkActions={[
          {
            label: tr("admin.sessions.bulkRevoke", {
              default: "Revoke selected",
            }),
            icon: LogOut,
            destructive: true,
            onClick: handleBulkRevoke,
          },
        ]}
        columns={{
          user: {
            label: tr("admin.sessions.colUser", { default: "User" }),
            cell: (s) => {
              const label =
                s.user?.email ||
                s.user?.username ||
                [s.user?.firstName, s.user?.lastName]
                  .filter(Boolean)
                  .join(" ") ||
                null;
              return label ? (
                <span className="font-medium">{label}</span>
              ) : (
                <span className="text-muted-foreground font-mono text-xs">
                  {s.userId?.slice(0, 8) ?? "—"}
                </span>
              );
            },
          },
          ip: {
            label: tr("admin.sessions.colIp", { default: "IP" }),
            cell: (s) => <code className="text-xs">{s.ip ?? "—"}</code>,
          },
          userAgent: {
            label: tr("admin.sessions.colDevice", { default: "Device" }),
            cell: (s) => {
              const ua = s.userAgent;
              const text = ua
                ? [ua.browser, ua.os].filter(Boolean).join(" • ") || "—"
                : "—";
              return (
                <span className="text-muted-foreground line-clamp-1 text-xs">
                  {text}
                </span>
              );
            },
          },
          createdAt: {
            label: tr("admin.sessions.colStarted", { default: "Started" }),
            sortable: true,
            cell: (s) => (
              <span className="text-muted-foreground text-xs">
                {String(l(s.createdAt, { date: "fromNow" }))}
              </span>
            ),
          },
          status: {
            label: tr("admin.sessions.colStatus", { default: "Status" }),
            cell: (s) => (
              <Badge variant={(s as any).revokedAt ? "outline" : "default"}>
                {(s as any).revokedAt
                  ? tr("admin.sessions.revokedBadge", { default: "Revoked" })
                  : tr("admin.sessions.active", { default: "Active" })}
              </Badge>
            ),
          },
        }}
        rowActions={(s) =>
          (s as any).revokedAt
            ? []
            : [
                {
                  label: tr("admin.sessions.revoke", { default: "Revoke" }),
                  icon: LogOut,
                  destructive: true,
                  onClick: (_s, { refresh }) => handleRevoke(s, refresh),
                },
              ]
        }
      />
    </div>
  );
}
