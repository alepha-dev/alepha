import { Button } from "@alepha/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Plug } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  OAuthConnection,
  SessionController,
} from "@/api/controllers/SessionController.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import type { I18n } from "../../../services/I18n.ts";

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
// The chip is cosmetic (green dot = an MCP client used the account in the
// last 24h), so 10-min staleness is fine and keeps the global header from
// generating background traffic every minute.
const POLL_INTERVAL_MS = 10 * 60 * 1000;

type ConnectionState = "live" | "stale" | "empty";

const computeState = (
  connections: OAuthConnection[],
  nowMs: number,
): ConnectionState => {
  if (connections.length === 0) return "empty";
  const recent = connections.some((c) => {
    if (!c.lastUsedAt) return false;
    const used = new Date(c.lastUsedAt).getTime();
    return Number.isFinite(used) && nowMs - used < RECENT_WINDOW_MS;
  });
  return recent ? "live" : "stale";
};

/**
 * Header chip exposing the OAuth / MCP connection state. A Plug icon with a
 * colored dot indicates whether an MCP client (Claude, etc.) is actively
 * talking to the user's account; the popover lists each connected app with
 * its last-used time and a Revoke action.
 *
 * Hidden when the user isn't logged in — connections are user-scoped.
 */
const HeaderConnectionsChip = () => {
  const { tr } = useI18n<I18n, "en">();
  const auth = useAuth();
  const router = useRouter<AppRouter>();
  const sessionApi = useClient<SessionController>();
  const dt = useInject(DateTimeProvider);

  const [connections, setConnections] = useState<OAuthConnection[]>([]);
  const [open, setOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => dt.nowMillis());

  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useMemo(
    () => async () => {
      if (!auth.user) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      try {
        const fresh =
          (await sessionApi.getMyConnections()) as OAuthConnection[];
        if (aliveRef.current) {
          setConnections(fresh);
          setNowMs(dt.nowMillis());
        }
      } catch {
        // Best-effort indicator — a transient API hiccup keeps the last
        // known state rather than blanking the chip.
      }
    },
    [auth.user, sessionApi, dt],
  );

  useEffect(() => {
    if (!auth.user) {
      setConnections([]);
      return;
    }
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [auth.user, refresh]);

  if (!auth.user) return null;

  const state = computeState(connections, nowMs);
  const dotColor =
    state === "live"
      ? "bg-emerald-500"
      : state === "stale"
        ? "bg-muted-foreground/60"
        : "";
  const ariaLabel = String(tr(`header.connections.state.${state}` as never));

  const revoke = async (id: string) => {
    await sessionApi.revokeSession({ params: { sessionId: id } });
    setConnections((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={ariaLabel}
            className="relative"
          />
        }
      >
        <Plug className="size-4" />
        {state !== "empty" ? (
          <span
            className={`absolute right-1 top-1 size-1.5 rounded-full ${dotColor}`}
          />
        ) : (
          <span className="border-muted-foreground/60 absolute right-1 top-1 size-1.5 rounded-full border" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-border flex flex-col border-b p-3">
          <span className="text-sm font-semibold">
            {tr("header.connections.title")}
          </span>
          <span className="text-muted-foreground text-xs">
            {tr(`header.connections.state.${state}` as never)}
          </span>
        </div>
        {connections.length === 0 ? (
          <div className="p-3">
            <p className="text-muted-foreground text-xs">
              {tr("header.connections.empty.body")}
            </p>
          </div>
        ) : (
          <ul className="divide-border max-h-80 divide-y overflow-y-auto">
            {connections.map((connection) => {
              const usedAt = connection.lastUsedAt
                ? dt.of(connection.lastUsedAt).fromNow()
                : String(tr("header.connections.row.never"));
              return (
                <li
                  key={connection.id}
                  className="flex items-center justify-between gap-2 p-3"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {connection.clientName}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {tr("header.connections.row.usedAt", { args: [usedAt] })}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600"
                    onClick={() => revoke(connection.id)}
                  >
                    {tr("header.connections.revoke")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-border border-t p-2">
          <Button
            render={<Link href={router.path("connections")} />}
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            onClick={() => setOpen(false)}
          >
            {tr("header.connections.manage")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default HeaderConnectionsChip;
