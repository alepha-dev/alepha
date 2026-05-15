import { Button } from "@alepha/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import type { ApiKeyController } from "alepha/api/keys";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Key, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppRouter } from "../../../AppRouter.ts";
import type { I18n } from "../../../services/I18n.ts";

interface ApiKeyRow {
  id: string;
  name: string;
  tokenPrefix: string;
  tokenSuffix: string;
  createdAt: string;
  lastUsedAt?: string;
  lastUsedIp?: string;
  usageCount: number;
}

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 60_000;

type ConnectionState = "live" | "stale" | "empty";

const computeState = (keys: ApiKeyRow[], nowMs: number): ConnectionState => {
  if (keys.length === 0) return "empty";
  const recent = keys.some((k) => {
    if (!k.lastUsedAt) return false;
    const used = new Date(k.lastUsedAt).getTime();
    return Number.isFinite(used) && nowMs - used < RECENT_WINDOW_MS;
  });
  return recent ? "live" : "stale";
};

/**
 * Header chip exposing the MCP / API-key connection state. Renders a Key
 * icon with a colored dot indicating whether Claude (or any client) is
 * actively talking to the user's account; the popover lists each active
 * key with its identifying suffix + last-used metadata.
 *
 * Hidden when the user isn't logged in — keys are user-scoped.
 */
const HeaderApiKeysChip = () => {
  const { tr } = useI18n<I18n, "en">();
  const auth = useAuth();
  const router = useRouter<AppRouter>();
  const apiKeyApi = useClient<ApiKeyController>();
  const dt = useInject(DateTimeProvider);

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [open, setOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => dt.nowMillis());

  // Track whether we should poll. `useRef` so the latest values are seen
  // by the interval closure without re-creating the timer on every keys
  // change.
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Single fetch helper; gated on auth + page visibility so we don't burn
  // requests for a logged-out user or a background tab.
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
        const fresh = (await apiKeyApi.listApiKeys()) as ApiKeyRow[];
        if (aliveRef.current) {
          setKeys(fresh);
          setNowMs(dt.nowMillis());
        }
      } catch {
        // Best-effort indicator — a transient API hiccup keeps the last
        // known state rather than blanking the chip.
      }
    },
    [auth.user, apiKeyApi, dt],
  );

  useEffect(() => {
    if (!auth.user) {
      setKeys([]);
      return;
    }
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [auth.user, refresh]);

  if (!auth.user) return null;

  const state = computeState(keys, nowMs);
  const dotColor =
    state === "live"
      ? "bg-emerald-500"
      : state === "stale"
        ? "bg-muted-foreground/60"
        : "";
  const ariaLabel = String(tr(`header.apiKeys.state.${state}` as never));

  const goToFullManager = () => {
    setOpen(false);
    router.push("apiKeys");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={ariaLabel}
          className="relative"
        >
          <Key className="size-4" />
          {state !== "empty" ? (
            <span
              className={`absolute right-1 top-1 size-1.5 rounded-full ${dotColor}`}
            />
          ) : (
            <span className="border-muted-foreground/60 absolute right-1 top-1 size-1.5 rounded-full border" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-border flex items-center justify-between border-b p-3">
          <div className="flex flex-col">
            <span className="text-sm font-semibold">
              {tr("header.apiKeys.title")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr(`header.apiKeys.state.${state}` as never)}
            </span>
          </div>
          <Button
            asChild
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            <Link href={router.path("apiKeys")}>
              <Plus className="size-3.5" />
              {tr("header.apiKeys.new")}
            </Link>
          </Button>
        </div>
        {keys.length === 0 ? (
          <div className="flex flex-col gap-2 p-3">
            <p className="text-muted-foreground text-xs">
              {tr("header.apiKeys.empty.body")}
            </p>
            <Button size="sm" onClick={goToFullManager} className="self-start">
              {tr("header.apiKeys.empty.cta")}
            </Button>
          </div>
        ) : (
          <ul className="divide-border max-h-80 divide-y overflow-y-auto">
            {keys.map((key) => {
              const usedAt = key.lastUsedAt
                ? dt.of(key.lastUsedAt).fromNow()
                : String(tr("header.apiKeys.row.never"));
              return (
                <li key={key.id} className="flex flex-col gap-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{key.name}</span>
                    <span className="text-muted-foreground font-mono text-[10px]">
                      {key.tokenPrefix}…{key.tokenSuffix}
                    </span>
                  </div>
                  <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
                    <span>
                      {tr("header.apiKeys.row.usedAt", { args: [usedAt] })}
                    </span>
                    <span>
                      {tr("header.apiKeys.row.usage", {
                        args: [String(key.usageCount ?? 0)],
                      })}
                    </span>
                  </div>
                  {key.lastUsedIp && (
                    <span className="text-muted-foreground text-[11px]">
                      {tr("header.apiKeys.row.ip", {
                        args: [key.lastUsedIp],
                      })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-border border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            onClick={goToFullManager}
          >
            {tr("header.apiKeys.manage")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default HeaderApiKeysChip;
