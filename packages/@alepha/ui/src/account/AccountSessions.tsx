import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { MySession, MySessionController } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Circle, CircleHelp, Monitor, Smartphone, Tablet } from "lucide-react";
import { useState } from "react";

export interface AccountSessionsProps {
  sessions?: MySession[];
}

/**
 * Where you are signed in, and how to stop being.
 *
 * Revoking a *single* session is unconfirmed; "sign out everywhere else" is
 * confirmed. The difference is reach, not reversibility — one session comes
 * back by signing in again, whereas the bulk action ends every other device
 * at once and there is no undo affordance to reach for afterwards. A prompt
 * on the per-row action would be click-through noise, which is what makes a
 * rare prompt worth reading.
 */
const AccountSessions = (props: AccountSessionsProps) => {
  const api = useClient<MySessionController>();
  const dt = useInject(DateTimeProvider);
  const dialog = useDialog();
  const toaster = useToast();
  const { tr } = useI18n();
  const [sessions, setSessions] = useState<MySession[]>(props.sessions ?? []);

  const deviceIcon = (session: MySession) => {
    if (session.userAgent?.device === "MOBILE") {
      return <Smartphone className="size-4" />;
    }
    if (session.userAgent?.device === "TABLET") {
      return <Tablet className="size-4" />;
    }
    // A monitor is a claim, not a neutral glyph: it says "this was a computer
    // with a screen". A client the parser could not place is drawn as such.
    if (!session.userAgent || session.userAgent.device === "UNKNOWN") {
      return <CircleHelp className="size-4" />;
    }
    return <Monitor className="size-4" />;
  };

  /**
   * The row's title, and the reason it is allowed to say nothing.
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

  /**
   * "Signed in 3 months ago" says when the session was born, not whether it
   * is still breathing: a long-lived session that refreshed this morning
   * looks identical to an abandoned one. `lastUsedAt` is the signal
   * someone hunting a stolen laptop is after, so it goes next to the IP.
   * Skipped for the current session, where it would always read "a few
   * seconds ago".
   */
  const description = (session: MySession) => {
    const parts = [
      session.ip ?? tr("account.sessions.unknownIp", { default: "unknown IP" }),
      tr("account.sessions.signedInAt", {
        default: "signed in $1",
        args: [dt.of(session.createdAt).fromNow()],
      }),
    ];
    if (session.lastUsedAt && !session.current) {
      parts.push(
        tr("account.sessions.lastUsedAt", {
          default: "last used $1",
          args: [dt.of(session.lastUsedAt).fromNow()],
        }),
      );
    }
    return parts.join(" · ");
  };

  const revoke = async (session: MySession) => {
    try {
      await api.deleteMySession({ params: { id: session.id } });
      setSessions((prev) => prev.filter((it) => it.id !== session.id));
    } catch (error: any) {
      toaster.show(
        error?.message ??
          tr("account.sessions.revokeError", {
            default: "Could not revoke that session",
          }),
        "danger",
      );
    }
  };

  const revokeOthers = async () => {
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
      return;
    }
    try {
      const { revoked } = await api.deleteMyOtherSessions();
      setSessions((prev) => prev.filter((it) => it.current));
      toaster.show(
        revoked === 1
          ? tr("account.sessions.revokedOne", {
              default: "1 session signed out",
            })
          : tr("account.sessions.revokedMany", {
              default: "$1 sessions signed out",
              args: [String(revoked)],
            }),
        "success",
      );
    } catch (error: any) {
      toaster.show(
        error?.message ??
          tr("account.sessions.revokeOthersError", {
            default: "Could not sign out the others",
          }),
        "danger",
      );
    }
  };

  const others = sessions.filter((it) => !it.current).length;

  return (
    <SettingsSection
      title={tr("account.sessions.title", { default: "Active sessions" })}
      description={tr("account.sessions.description", {
        default: "Revoke any session you do not recognise.",
      })}
    >
      {sessions.map((session) => (
        <SettingsRow
          key={session.id}
          label={
            <span className="flex items-center gap-2">
              <Circle
                aria-hidden
                className={
                  session.current
                    ? "size-2 fill-green-500 text-green-500"
                    : "fill-muted-foreground text-muted-foreground size-2"
                }
              />
              {deviceIcon(session)}
              {label(session)}
              {session.current ? (
                <span className="text-muted-foreground text-xs">
                  {tr("account.sessions.current", { default: "(this device)" })}
                </span>
              ) : null}
            </span>
          }
          description={description(session)}
        >
          {session.current ? null : (
            <Button variant="ghost" size="sm" onClick={() => revoke(session)}>
              {tr("account.sessions.revoke", { default: "Revoke" })}
            </Button>
          )}
        </SettingsRow>
      ))}

      {others > 0 ? (
        <SettingsRow
          label={tr("account.sessions.revokeOthers", {
            default: "Sign out everywhere else",
          })}
          description={tr("account.sessions.revokeOthersHint", {
            default: "Ends every session except this one.",
          })}
        >
          <Button variant="destructive" size="sm" onClick={revokeOthers}>
            {others === 1
              ? tr("account.sessions.signOutOne", {
                  default: "Sign out 1 other",
                })
              : tr("account.sessions.signOutMany", {
                  default: "Sign out $1 others",
                  args: [String(others)],
                })}
          </Button>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
};

export default AccountSessions;
