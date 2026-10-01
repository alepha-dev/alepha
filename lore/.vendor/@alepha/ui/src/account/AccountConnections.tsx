import type { MyConnection, MyConnectionController } from "alepha/api/users";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Plug, Unplug } from "lucide-react";
import { useState } from "react";

import { Badge } from "../core/Badge.tsx";
import TimeAgo from "../core/TimeAgo.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { DataTable } from "../table/DataTable.tsx";
import { AccountPage } from "./AccountPage.tsx";

export interface AccountConnectionsProps {
  connections?: MyConnection[];
}

/**
 * Applications holding access to this account through OAuth (an MCP client,
 * a CLI, a third-party integration), as a `DataTable` over the list the route
 * loader fetched.
 *
 * `listMyConnections` returns the whole list unpaginated, so the table is
 * handed the array (`data`) and pages it in memory. A disconnect drops the
 * row from the array, which is the table's refresh in this mode.
 *
 * Confirmed on disconnect. A session comes back by signing in again; a
 * connection comes back only by re-running whatever authorization flow
 * created it, which for an MCP client means going to reconnect it from the
 * other side.
 */
const AccountConnections = (props: AccountConnectionsProps) => {
  const api = useClient<MyConnectionController>();
  const dialog = useDialog();
  const { tr } = useI18n();

  const [connections, setConnections] = useState<MyConnection[]>(
    props.connections ?? [],
  );

  const revoke = useAction<[connection: MyConnection], boolean>(
    {
      handler: async (connection) => {
        const ok = await dialog.confirm({
          title: tr("account.connections.revokeTitle", {
            default: "Disconnect $1?",
            args: [connection.clientName],
          }),
          description: tr("account.connections.revokeDescription", {
            default:
              "It loses access immediately and has to be authorized again to come back.",
          }),
          confirmLabel: tr("account.connections.revoke", {
            default: "Disconnect",
          }),
          destructive: true,
        });
        if (!ok) {
          return false;
        }
        await api.revokeMyConnection({ params: { id: connection.id } });
        setConnections((prev) => prev.filter((it) => it.id !== connection.id));
        return true;
      },
    },
    [api, dialog, tr],
  );

  return (
    <AccountPage variant="table">
      <DataTable<MyConnection>
        className="min-h-0 flex-1"
        data={connections}
        rowKey={(connection) => connection.id}
        /*
          Today's copy, kept: the page's description and what an empty list
          means. An empty page that drops the description reads as a
          different page, and the sentence is what a reader with nothing on
          screen needs.
        */
        emptyState={{
          icon: Plug,
          title: tr("account.connections.empty", {
            default: "Nothing is connected",
          }),
          description: `${tr("account.connections.description", {
            default: "Applications that can act on your behalf.",
          })} ${tr("account.connections.emptyDescription", {
            default: "Applications you authorize will appear here.",
          })}`,
        }}
        columns={{
          clientName: {
            label: tr("account.connections.colApp", { default: "App" }),
            sortable: true,
            cell: (connection) => (
              <span
                className="flex items-center gap-2"
                data-testid="account-connection-name"
              >
                <Plug className="text-muted-foreground size-4 shrink-0" />
                <span className="font-medium">{connection.clientName}</span>
                {connection.current ? (
                  <Badge tone="success">
                    {tr("account.connections.current", {
                      default: "(this one)",
                    })}
                  </Badge>
                ) : null}
              </span>
            ),
          },
          /*
            ⚠️ Said out loud, not hidden. The list groups by client, so one
            row can stand for several authorizations, and a reader deciding
            whether to disconnect should know how many go with it.
          */
          sessionCount: {
            label: tr("account.connections.colSessions", {
              default: "Sessions",
            }),
            sortable: true,
            align: "right",
            cell: (connection) => (
              <span className="text-muted-foreground text-xs tabular-nums">
                {connection.sessionCount}
              </span>
            ),
          },
          createdAt: {
            label: tr("account.connections.colConnected", {
              default: "Connected",
            }),
            sortable: true,
            cell: (connection) => (
              <TimeAgo
                value={connection.createdAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
          lastUsedAt: {
            label: tr("account.connections.colLastUsed", {
              default: "Last used",
            }),
            sortable: true,
            cell: (connection) =>
              connection.lastUsedAt ? (
                <TimeAgo
                  value={connection.lastUsedAt}
                  className="text-muted-foreground text-xs"
                />
              ) : (
                <span className="text-muted-foreground text-xs">
                  {tr("account.connections.never", { default: "Never" })}
                </span>
              ),
          },
          expiresAt: {
            label: tr("account.connections.colExpires", {
              default: "Access ends",
            }),
            sortable: true,
            cell: (connection) => (
              <TimeAgo
                value={connection.expiresAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
        }}
        rowActions={(connection) => [
          {
            label: tr("account.connections.revoke", { default: "Disconnect" }),
            icon: Unplug,
            destructive: true,
            disabled: () => revoke.loading,
            onClick: () => void revoke.run(connection),
          },
        ]}
      />
    </AccountPage>
  );
};

export default AccountConnections;
