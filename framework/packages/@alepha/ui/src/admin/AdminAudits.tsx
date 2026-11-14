import * as React from "react";

import TimeAgo from "../core/TimeAgo.tsx";

void React;

import { z } from "alepha";
import type {
  AdminAuditController,
  AuditActionPair,
  AuditEntity,
} from "alepha/api/audits";
import type { AdminUserController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  CircleDot,
  Layers,
  ListFilter,
  SlidersHorizontal,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "../core/Badge.tsx";
import { useToast } from "../core/useToast.tsx";
import { DataTable } from "../table/DataTable.tsx";
import type {
  DataTableFilterFields,
  DataTableFilterValues,
} from "../table/dataTableTypes.ts";
import { adminAuditDayRange } from "./adminDashboardWindows.ts";
import { AdminPage } from "./AdminPage.tsx";
import { AdminUserCell } from "./AdminUserCell.tsx";
import { useConfirmedAction } from "./useConfirmedAction.tsx";

export const AdminAudits = () => {
  const client = useClient<AdminAuditController>();
  const userClient = useClient<AdminUserController>();
  const toast = useToast();
  const router = useRouter<any>();
  const { tr } = useI18n();

  const [actions, setActions] = useState<AuditActionPair[]>([]);

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

  /**
   * Every filter optional, so this page stays the view that shows everything:
   * an admin who cannot see a row cannot audit it.
   */
  const filterFields = {
    // Here because tenant-scoped events (a project's own activity, read on
    // the project's page) otherwise bury the deployment's security events
    // under their volume.
    layer: {
      schema: z.enum(["app", "scoped"]),
      label: tr("admin.audits.colScope", { default: "Scope" }),
      icon: Layers,
      items: [
        {
          value: "app",
          label: tr("admin.audits.layerApp", { default: "App" }),
        },
        {
          value: "scoped",
          label: tr("admin.audits.layerScoped", { default: "Scoped" }),
        },
      ],
      control: {
        clearLabel: tr("admin.audits.layerAll", { default: "All layers" }),
      },
    },
    /**
     * When, as a closed range of calendar days.
     *
     * ⚠️ Deliberately NOT a `dateRange` field on `auditQuerySchema`. That
     * schema declares `from`, `to` and `after` with documented semantics
     * (`after` is an exclusive cursor), and two ways to say one thing in a
     * public query schema is a smell. The mapping happens in the fetcher
     * below, which is also what proves a range control can drive an existing
     * from/to endpoint with no API churn at all.
     */
    createdAt: {
      schema: z.dateRange(),
      label: tr("admin.audits.colWhen", { default: "When" }),
      placeholder: tr("admin.audits.dateAll", { default: "Any date" }),
    },
    status: {
      schema: z.enum(["ok", "failed"]),
      label: tr("admin.audits.colStatus", { default: "Status" }),
      icon: CircleDot,
      items: [
        { value: "ok", label: tr("admin.audits.ok", { default: "OK" }) },
        {
          value: "failed",
          label: tr("admin.audits.failed", { default: "Failed" }),
        },
      ],
      control: {
        clearLabel: tr("admin.audits.statusAll", { default: "All status" }),
      },
    },
    /**
     * Several types at once (`?type=auth,security`), mapped to the
     * comma-separated `type` the query already takes. The dashboard's Failed
     * sign-ins tile links here with the two types it counts; the `action`
     * filter below is one `type:action` pair and could not say that.
     */
    type: {
      schema: z.array(z.string()),
      label: tr("admin.audits.filterType", { default: "Type" }),
      icon: ListFilter,
      items: [...new Set(actions.map((pair) => pair.type))].map((type) => ({
        value: type,
        label: type,
      })),
      control: {
        clearLabel: tr("admin.audits.typeAll", { default: "All types" }),
      },
    },
    action: {
      schema: z.string(),
      label: tr("admin.audits.colAction", { default: "Action" }),
      icon: Zap,
      // Sorted by type then action on the server, so the list reads grouped:
      // every `parameter:*` row, then every `user:*` row. The label is the
      // column's own `type:action`, and the type rides along as the tag so
      // the group is visible at a glance.
      items: actions.map((pair) => ({
        value: auditActionKey(pair),
        label: auditActionKey(pair),
        tag: pair.type,
      })),
      control: {
        clearLabel: tr("admin.audits.actionAll", { default: "All actions" }),
      },
    },
    /**
     * Every action of one user (#Q3432). A server-searched user picker: the
     * list of users is not all here, and `resolve` names the one already
     * picked, from a shared link or the stored filters. Hidden for an admin
     * who may not list users, whose picker could only come up empty.
     */
    userId: {
      schema: z.string(),
      label: tr("admin.audits.colActor", { default: "Actor" }),
      icon: User,
      column: "actor",
      hidden: !userClient.findUsers.can(),
      control: {
        clearLabel: tr("admin.audits.actorAll", { default: "All actors" }),
        searchable: true,
        loaderThreshold: 0,
        // `items` as a function is the select's loader; its second argument
        // asks for the labels of values already picked.
        items: async (search: string, resolve?: string[]) => {
          const label = (u: {
            id: string;
            email?: string;
            username?: string;
          }) => u.email || u.username || u.id;
          if (resolve?.length) {
            const users = await Promise.all(
              resolve.map((id) =>
                userClient.getUser({ params: { id } }).catch(() => undefined),
              ),
            );
            return users
              .filter((u) => u !== undefined)
              .map((u) => ({ value: u.id, label: label(u) }));
          }
          const page = await userClient.findUsers({
            query: { search: search || undefined, size: 20 },
          });
          return page.content.map((u) => ({ value: u.id, label: label(u) }));
        },
      },
    },
  } satisfies DataTableFilterFields;

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: DataTableFilterValues<typeof filterFields>;
    }) => {
      const f = params.filters;
      // The picked value is a `type:action` key, the shape the Action column
      // prints, and the query takes it apart. `action` alone selected every
      // type's `create` at once (feedback #2049).
      const pair = f?.action
        ? auditActionFromKey(f.action, actions)
        : undefined;
      return client.findAudits({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          // A picked `type:action` pair names its type; otherwise the types.
          type: pair?.type ?? (f?.type?.length ? f.type.join(",") : undefined),
          action: pair?.action,
          layer: f?.layer,
          userId: f?.userId || undefined,
          success: f?.status ? f.status === "ok" : undefined,
          // A day resolved to an instant, in UTC. The reader arguably means
          // their local day, but the server is not told their offset and UTC
          // is what makes a shared link select the same rows for everyone. The
          // end runs to the last millisecond so a one-day range selects that
          // day rather than nothing.
          ...(f?.createdAt?.length === 2
            ? adminAuditDayRange(f.createdAt[0]!, f.createdAt[1]!)
            : {}),
        },
      });
    },
    [client, actions],
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
          count: items.length,
          default: {
            one: "Delete {count} audit record? Audit logs are usually retained for compliance. This cannot be undone.",
            other:
              "Delete {count} audit records? Audit logs are usually retained for compliance. This cannot be undone.",
          },
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
            count: res.deleted.length,
            default: {
              one: "{count} audit record deleted",
              other: "{count} audit records deleted",
            },
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
      onClick={() => router.push(href)}
      className="hover:text-primary inline-flex items-center gap-1.5 truncate text-start text-xs underline-offset-2 hover:underline"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <AdminPage>
      <DataTable<AuditEntity, typeof filterFields>
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
        // The dashboard's Failed sign-ins tile links here with these three.
        filters={{
          fields: filterFields,
          fromQuery: ["type", "status", "createdAt"],
        }}
        columns={{
          createdAt: {
            label: tr("admin.audits.colWhen", { default: "When" }),
            sortable: true,
            cell: (a) => (
              <TimeAgo
                value={a.createdAt}
                className="text-muted-foreground text-xs"
              />
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
          scope: {
            label: tr("admin.audits.colScope", { default: "Scope" }),
            // Without this the Scoped filter shows rows with no way to tell
            // which tenant they belong to, which is a filter that narrows to
            // an unreadable list.
            cell: (a) =>
              a.scopeType ? (
                <span className="font-mono text-xs">
                  {a.scopeType}:{a.scopeId ?? "?"}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("admin.audits.layerApp", { default: "App" })}
                </span>
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
};

export default AdminAudits;

/**
 * The filter's value for a pair: what the Action column prints.
 */
export const auditActionKey = (pair: AuditActionPair): string =>
  `${pair.type}:${pair.action}`;

/**
 * The pair behind a picked key.
 *
 * Looked up in the fetched list rather than split on the colon, so a type
 * that happens to carry one is never cut in the wrong place. The split is
 * only the fallback for a key the list no longer holds (a stale persisted
 * filter), where guessing at the first colon beats sending nothing.
 */
export const auditActionFromKey = (
  key: string,
  pairs: AuditActionPair[],
): AuditActionPair => {
  const known = pairs.find((pair) => auditActionKey(pair) === key);
  if (known) return known;
  const at = key.indexOf(":");
  return at < 0
    ? { type: key, action: "" }
    : { type: key.slice(0, at), action: key.slice(at + 1) };
};
