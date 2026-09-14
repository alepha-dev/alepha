import * as React from "react";

import TimeAgo from "../core/TimeAgo.tsx";

void React;

import { z } from "alepha";
import type { AdminSessionController, SessionResource } from "alepha/api/users";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { CircleDot, Clock, Globe, LogOut } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { AlephaTable } from "../table/AlephaTable.tsx";
import type {
  AlephaTableFilterFields,
  AlephaTableFilterValues,
} from "../table/alephaTableTypes.ts";
import { AdminPage } from "./AdminPage.tsx";
import { AdminUserCell } from "./AdminUserCell.tsx";
import { useConfirmedAction } from "./useConfirmedAction.tsx";

/**
 * Windows offered for "last used", in hours, because a session's whole life
 * is usually measured in them.
 *
 * ⚠️ A literal `labelKey`, never `admin.sessions.lastUsed${hours}`.
 * `uiFr.spec.ts` extracts keys by reading them out of the source, so an
 * interpolated one is invisible to it in both directions: the French
 * catalogue would report the translations as unused extras while the
 * component silently fell back to English. This is the declarative form that
 * check already understands, and the reason it understands it.
 *
 * That regex reads comments too, so this one avoids writing an example key.
 */
const LAST_USED_WINDOWS = [
  { hours: "1", labelKey: "admin.sessions.lastUsed1", fallback: "Last hour" },
  { hours: "24", labelKey: "admin.sessions.lastUsed24", fallback: "Last day" },
  {
    hours: "168",
    labelKey: "admin.sessions.lastUsed168",
    fallback: "Last week",
  },
] as const;

export const AdminSessions = () => {
  const client = useClient<AdminSessionController>();
  const toast = useToast();
  const dialog = useDialog();
  const { l, tr } = useI18n();

  // Same shape as the audit log's action facet: the values come from the
  // rows, so the control offers the countries this instance has actually seen
  // rather than all 249. Failure costs the facet, not the page.
  const [countries, setCountries] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    client
      .getSessionCountries()
      .then((rows) => {
        if (alive) setCountries(rows);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client]);

  /**
   * The filter bar this page rendered empty until #1319.
   *
   * Free-form strings rather than enums, for the reason `AdminUsers` gives:
   * an unknown value left in a stored filter falls back to "all" instead of
   * failing to decode.
   */
  const filterFields = {
    search: {
      preset: "search",
      control: {
        inputProps: {
          // What this box matches: it is the one search that also takes an
          // IP, which nobody guesses. A title is a hover hint and the field's
          // accessible description.
          title: tr("admin.sessions.searchHint", {
            default: "Email, username or IP",
          }),
        },
      },
    },
    status: {
      schema: z.string(),
      label: tr("admin.sessions.filterStatus", { default: "Status" }),
      icon: CircleDot,
      items: [
        {
          value: "active",
          label: tr("admin.sessions.statusActive", { default: "Active" }),
        },
        {
          value: "expired",
          label: tr("admin.sessions.statusExpired", { default: "Expired" }),
        },
      ],
      control: {
        clearLabel: tr("admin.sessions.statusAll", { default: "All sessions" }),
      },
    },
    // The countries this instance has actually seen, rather than all 249.
    country: {
      schema: z.string(),
      label: tr("admin.sessions.filterCountry", { default: "Country" }),
      icon: Globe,
      items: countries.map((code) => ({ value: code, label: code })),
      control: {
        clearLabel: tr("admin.sessions.countryAll", {
          default: "All countries",
        }),
      },
    },
    lastUsed: {
      schema: z.string(),
      label: tr("admin.sessions.colLastUsed", { default: "Last used" }),
      icon: Clock,
      items: LAST_USED_WINDOWS.map((window) => ({
        value: window.hours,
        label: tr(window.labelKey, { default: window.fallback }),
      })),
      control: {
        clearLabel: tr("admin.sessions.lastUsedAny", { default: "Any time" }),
      },
    },
  } satisfies AlephaTableFilterFields;

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: AlephaTableFilterValues<typeof filterFields>;
    }) => {
      const { filters, ...page } = params;
      return client.findSessions({
        query: {
          ...page,
          search: filters?.search || undefined,
          country: filters?.country || undefined,
          status: (filters?.status as "active" | "expired") || undefined,
          lastUsedWithinHours: filters?.lastUsed
            ? Number(filters.lastUsed)
            : undefined,
        },
      });
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
      <AlephaTable<SessionResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey="admin.sessions"
        fetch={fetcher}
        filters={{ fields: filterFields }}
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
              // "Unknown" is what the parser reports for a client it could
              // not place (an API caller, an OAuth or MCP agent). Printing it
              // twice tells an admin less than the placeholder this column
              // already uses for a session carrying no agent at all.
              const text =
                (ua
                  ? [ua.browser, ua.os]
                      .filter((part) => part && part !== "Unknown")
                      .join(" • ")
                  : "") || "—";
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
              <TimeAgo
                value={s.createdAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
          lastUsedAt: {
            label: tr("admin.sessions.colLastUsed", { default: "Last used" }),
            sortable: true,
            cell: (s) => (
              <span className="text-muted-foreground text-xs">
                {s.lastUsedAt
                  ? l(s.lastUsedAt, { date: "fromNow" })
                  : tr("admin.sessions.lastUsedNever", { default: "Never" })}
              </span>
            ),
          },
          expiresAt: {
            label: tr("admin.sessions.colExpires", { default: "Expires" }),
            cell: (s) => (
              <TimeAgo
                value={s.expiresAt}
                className="text-muted-foreground text-xs"
              />
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
};

export default AdminSessions;
