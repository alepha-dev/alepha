import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { AdminUserCell } from "@alepha/ui/components/admin/admin-user-cell";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { AdminSessionController, SessionResource } from "alepha/api/users";
import { useAction, useClient } from "alepha/react";
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
      return client.findSessions({ query: params });
    },
    [client],
  );

  const revoke = useConfirmedAction<[SessionResource, () => void]>(
    {
      confirm: {
        title: tr("admin.sessions.revokeTitle", { default: "Revoke session" }),
        description: tr("admin.sessions.revokeConfirm", {
          default: "The user will be signed out from this session.",
        }),
        destructive: true,
      },
      handler: async (s, refresh) => {
        await client.deleteSession({ params: { id: s.id } });
        refresh();
      },
      success: tr("admin.sessions.revoked", { default: "Session revoked" }),
    },
    [client, tr],
  );

  const bulkRevoke = useAction<
    [SessionResource[], { clearSelection: () => void; refresh: () => void }]
  >(
    {
      handler: async (items, ctx) => {
        if (items.length === 0) return;
        const ok = await dialog.confirm({
          title: tr("admin.sessions.bulkRevokeTitle", {
            default: "Revoke sessions",
          }),
          description: tr("admin.sessions.bulkRevokeConfirm", {
            default: `Revoke ${items.length} session(s)? Affected users will be signed out.`,
            args: [String(items.length)],
          }),
          destructive: true,
        });
        if (!ok) return;
        const res = await client.deleteSessions({
          body: { ids: items.map((s) => s.id) },
        });
        toast.success(
          tr("admin.sessions.bulkRevoked", {
            default: `${res.deleted.length} session(s) revoked`,
            args: [String(res.deleted.length)],
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
            onClick: (items, ctx) => bulkRevoke.run(items, ctx),
          },
        ]}
        columns={{
          user: {
            label: tr("admin.sessions.colUser", { default: "User" }),
            cell: (s) => <AdminUserCell userId={s.userId} user={s.user} />,
          },
          ip: {
            label: tr("admin.sessions.colIp", { default: "IP" }),
            cell: (s) => (
              <span className="flex items-center gap-1.5">
                <code className="text-xs">{s.ip ?? "—"}</code>
                {s.country ? (
                  <span className="text-muted-foreground text-xs uppercase">
                    {s.country}
                  </span>
                ) : null}
              </span>
            ),
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
          lastUsedAt: {
            label: tr("admin.sessions.colLastUsed", { default: "Last used" }),
            sortable: true,
            cell: (s) => (
              <span className="text-muted-foreground text-xs">
                {s.lastUsedAt
                  ? String(l(s.lastUsedAt, { date: "fromNow" }))
                  : tr("admin.sessions.lastUsedNever", { default: "Never" })}
              </span>
            ),
          },
          expiresAt: {
            label: tr("admin.sessions.colExpires", { default: "Expires" }),
            cell: (s) => (
              <span className="text-muted-foreground text-xs">
                {String(l(s.expiresAt, { date: "fromNow" }))}
              </span>
            ),
          },
        }}
        rowActions={(s) => [
          {
            label: tr("admin.sessions.revoke", { default: "Revoke" }),
            icon: LogOut,
            destructive: true,
            onClick: (_s, { refresh }) => revoke.run(s, refresh),
          },
        ]}
      />
    </AdminPage>
  );
}

export default AdminSessions;
