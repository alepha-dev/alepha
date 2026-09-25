import type { MySession, MySessionController } from "alepha/api/users";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  CircleHelp,
  LogOut,
  Monitor,
  RadioTower,
  Smartphone,
  Tablet,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "../core/Badge.tsx";
import TimeAgo from "../core/TimeAgo.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { DataTable } from "../table/DataTable.tsx";
import { AccountPage } from "./AccountPage.tsx";

export interface AccountSessionsProps {
  sessions?: MySession[];
}

/**
 * Where you are signed in, and how to stop being: a `DataTable` over the
 * sessions the route loader fetched.
 *
 * `listMySessions` returns the whole list unpaginated, so the table is given
 * the array (`data`) and pages, sorts and filters it in memory
 * (`paginateLocal`). A revoke answers with nothing to re-read: the handler
 * drops the row from the array it owns, which is the table's refresh in this
 * mode.
 *
 * The current session carries a "This device" badge and no row action: the
 * way to end it is to sign out, and a row button that signs you out of the
 * page you are reading is a trap. "Sign out everywhere else" is the toolbar's
 * primary action, shown while there is anything else to end.
 *
 * Both writes are confirmed. They are `useAction` runs, so a failure is
 * toasted by the shell's `ActionErrorToaster`, and every row action and the
 * toolbar button are disabled while either is in flight.
 */
const AccountSessions = (props: AccountSessionsProps) => {
  const api = useClient<MySessionController>();
  const dialog = useDialog();
  const toast = useToast();
  const { tr } = useI18n();
  const [sessions, setSessions] = useState<MySession[]>(props.sessions ?? []);

  const deviceIcon = (session: MySession) => {
    if (session.userAgent?.device === "MOBILE") {
      return <Smartphone className="size-4 shrink-0" />;
    }
    if (session.userAgent?.device === "TABLET") {
      return <Tablet className="size-4 shrink-0" />;
    }
    // A monitor is a claim, not a neutral glyph: it says "this was a computer
    // with a screen". A client the parser could not place is drawn as such.
    if (!session.userAgent || session.userAgent.device === "UNKNOWN") {
      return <CircleHelp className="size-4 shrink-0" />;
    }
    return <Monitor className="size-4 shrink-0" />;
  };

  /**
   * The device's name, and the reason it is allowed to say nothing.
   *
   * A session minted for an API client or an OAuth/MCP agent carries a
   * user-agent the parser cannot place, and naming it after whichever
   * browser happens to be commonest would be inventing evidence about where
   * an account is signed in. Both halves unknown reads as one honest
   * "Unknown device" rather than "Unknown on Unknown".
   */
  const label = (session: MySession) => {
    const agent = session.userAgent;
    if (!agent || (agent.browser === "Unknown" && agent.os === "Unknown")) {
      return tr("account.sessions.unknownDevice", {
        default: "Unknown device",
      });
    }
    return tr("account.sessions.deviceLabel", {
      default: "$1 on $2",
      args: [agent.browser, agent.os],
    });
  };

  const revoke = useAction<[session: MySession], boolean>(
    {
      handler: async (session) => {
        const ok = await dialog.confirm({
          title: tr("account.sessions.revokeTitle", {
            default: "Revoke this session?",
          }),
          description: tr("account.sessions.revokeDescription", {
            default:
              "That browser or device is signed out. Signing in again there starts a new session.",
          }),
          confirmLabel: tr("account.sessions.revoke", { default: "Revoke" }),
          destructive: true,
        });
        if (!ok) {
          return false;
        }
        await api.deleteMySession({ params: { id: session.id } });
        setSessions((prev) => prev.filter((it) => it.id !== session.id));
        return true;
      },
    },
    [api, dialog, tr],
  );

  const revokeOthers = useAction<[], boolean>(
    {
      handler: async () => {
        const ok = await dialog.confirm({
          title: tr("account.sessions.revokeOthersTitle", {
            default: "Sign out everywhere else?",
          }),
          description: tr("account.sessions.revokeOthersDescription", {
            default:
              "Every other browser and device will be signed out. This one stays signed in.",
          }),
          confirmLabel: tr("account.sessions.revokeOthers", {
            default: "Sign out everywhere else",
          }),
          destructive: true,
        });
        if (!ok) {
          return false;
        }
        const { revoked } = await api.deleteMyOtherSessions();
        setSessions((prev) => prev.filter((it) => it.current));
        toast.success(
          revoked === 1
            ? tr("account.sessions.revokedOne", {
                default: "1 session signed out",
              })
            : tr("account.sessions.revokedMany", {
                default: "$1 sessions signed out",
                args: [String(revoked)],
              }),
        );
        return true;
      },
    },
    [api, dialog, toast, tr],
  );

  const busy = revoke.loading || revokeOthers.loading;
  const others = sessions.filter((it) => !it.current).length;

  return (
    <AccountPage variant="table">
      <DataTable<MySession>
        className="min-h-0 flex-1"
        data={sessions}
        rowKey={(session) => session.id}
        defaultSort={{ field: "lastUsedAt", direction: "desc" }}
        actions={
          others > 0
            ? [
                {
                  icon: LogOut,
                  primary: true,
                  disabled: busy,
                  label:
                    others === 1
                      ? tr("account.sessions.signOutOne", {
                          default: "Sign out 1 other",
                        })
                      : tr("account.sessions.signOutMany", {
                          default: "Sign out $1 others",
                          args: [String(others)],
                        }),
                  onClick: () => void revokeOthers.run(),
                },
              ]
            : []
        }
        emptyState={{
          icon: RadioTower,
          title: tr("account.sessions.title", { default: "Active sessions" }),
          description: tr("account.sessions.description", {
            default: "Revoke any session you do not recognise.",
          }),
        }}
        columns={{
          device: {
            label: tr("account.sessions.colDevice", { default: "Device" }),
            cell: (session) => (
              <span
                className="flex items-center gap-2"
                data-testid="account-session-device"
              >
                {deviceIcon(session)}
                <span className="truncate">{label(session)}</span>
                {session.current ? (
                  <Badge tone="success" data-testid="account-session-current">
                    {tr("account.sessions.thisDevice", {
                      default: "This device",
                    })}
                  </Badge>
                ) : null}
              </span>
            ),
          },
          ip: {
            label: tr("account.sessions.colIp", { default: "IP" }),
            cell: (session) => (
              <span className="flex items-center gap-1.5">
                <code className="text-xs">
                  {session.ip ??
                    tr("account.sessions.unknownIp", {
                      default: "unknown IP",
                    })}
                </code>
                {session.country ? (
                  <span className="text-muted-foreground text-xs uppercase">
                    {session.country}
                  </span>
                ) : null}
              </span>
            ),
          },
          createdAt: {
            label: tr("account.sessions.colSignedIn", {
              default: "Signed in",
            }),
            sortable: true,
            cell: (session) => (
              <TimeAgo
                value={session.createdAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
          /*
            When the session was last used, not when it was born: a
            long-lived session that refreshed this morning looks identical to
            an abandoned one by its start date, and this is the column
            somebody hunting a stolen laptop reads.
          */
          lastUsedAt: {
            label: tr("account.sessions.colLastUsed", {
              default: "Last used",
            }),
            sortable: true,
            cell: (session) =>
              session.lastUsedAt ? (
                <TimeAgo
                  value={session.lastUsedAt}
                  className="text-muted-foreground text-xs"
                />
              ) : (
                <span className="text-muted-foreground text-xs">-</span>
              ),
          },
        }}
        rowActions={(session) =>
          session.current
            ? []
            : [
                {
                  label: tr("account.sessions.revoke", { default: "Revoke" }),
                  icon: LogOut,
                  destructive: true,
                  disabled: () => busy,
                  onClick: () => void revoke.run(session),
                },
              ]
        }
      />
    </AccountPage>
  );
};

export default AccountSessions;
