import { Button } from "@alepha/ui/components/ui/button";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Circle, Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import type {
  SessionController,
  UserSession,
} from "@/api/controllers/SessionController.ts";
import type { I18n } from "../../services/I18n.ts";

export interface MySessionsProps {
  sessions: Array<UserSession>;
}

const MySessions = (props: MySessionsProps) => {
  const dt = useInject(DateTimeProvider);
  const [sessions, setSessions] = useState<Array<UserSession>>(props.sessions);
  const auth = useAuth();
  const sessionApi = useClient<SessionController>();
  const dialog = useDialog();
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="flex w-full flex-col gap-2 p-2">
      <div className="flex items-center justify-between p-2">
        <span className="text-xs text-muted-foreground">
          You can revoke any session to log out from it.
        </span>
        {/*
          Confirmed, while the per-row Revoke below is not. The difference is
          reach, not reversibility: this one signs you out of every device
          including this one, so the click that ends it also removes the
          surface you would undo it from. A single session (or a connection on
          the neighbouring page) comes back by signing in or authorizing again,
          and the copy on both pages already says so — a prompt there would be
          click-through noise, which is what makes a rare prompt worth reading.
        */}
        <Button
          variant="ghost"
          size="sm"
          className="text-red-500 hover:text-red-600"
          onClick={async () => {
            const ok = await dialog.confirm({
              title: String(tr("profile.sessions.revokeAll.title")),
              description: String(tr("profile.sessions.revokeAll.description")),
              confirmLabel: String(tr("profile.sessions.revokeAll.confirm")),
              destructive: true,
            });
            if (!ok) {
              return;
            }
            await sessionApi.revokeAllSessions();
            auth.logout();
          }}
        >
          Revoke All
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3 shadow-sm"
          >
            <Circle
              className={`size-3 ${session.current ? "fill-green-500 text-green-500" : "fill-muted-foreground text-muted-foreground"}`}
            />
            <div className="flex items-center justify-center">
              {session.userAgent?.device === "MOBILE" ? (
                <Smartphone className="size-4" />
              ) : (
                <Monitor className="size-4" />
              )}
            </div>
            <div className="flex flex-1 flex-col">
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {session.userAgent?.browser} ({session.userAgent?.os})
                </span>
                <span className="text-xs text-muted-foreground">
                  {session.ip}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                Signed in {dt.of(session.createdAt).fromNow()}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={async () => {
                if (session.current) {
                  auth.logout();
                } else {
                  await sessionApi.revokeSession({
                    params: { sessionId: session.id },
                  });
                  setSessions((prev) =>
                    prev.filter((s) => s.id !== session.id),
                  );
                }
              }}
            >
              {session.current ? "Sign out" : "Revoke"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MySessions;
