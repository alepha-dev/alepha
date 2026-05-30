import { Button } from "@alepha/ui/components/ui/button";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ChevronLeft, ChevronRight, History, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FolioController } from "@/api/controllers/FolioController.ts";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../services/I18n.ts";

type Action = "create" | "edit" | "rename" | "tag-change" | "revert";

interface ActivityItem {
  id: string;
  at: string;
  action: Action;
  byUserId?: string;
  byUsername?: string;
  byAvatarUrl?: string;
  folioId: string;
  folioShortId: number;
  folioTitle: string;
}

const OPEN_KEY = "lor.archive.activityPanel.open";

const readOpen = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(OPEN_KEY) === "1";
};

/**
 * Right-side "Recent activity" panel on the Archive browse page.
 * Campaign-scoped feed of folio revisions (create / edit / rename /
 * tag-change / revert) across all folios. Collapsed by default; the
 * open/closed bit is persisted per browser in localStorage so it
 * survives reloads.
 *
 * Fetches on open (and on manual refresh). No polling — other members'
 * edits show up the next time the panel is opened or refreshed.
 *
 * See Lore quest #105.
 */
const ArchiveActivityPanel = () => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const folioApi = useClient<FolioController>();
  const [campaign] = useStore(currentCampaignAtom);
  const [open, setOpen] = useState<boolean>(readOpen);
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  }, [open]);

  const load = useCallback(async () => {
    if (!campaign?.id) return;
    setLoading(true);
    try {
      const res = await folioApi.listCampaignActivity({
        query: { campaignId: campaign.id, limit: 50 },
      });
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, [campaign?.id, folioApi]);

  // Lazy fetch — only load when the panel is open. Subsequent opens
  // reuse the cached list; the explicit RefreshCw is the way to pull
  // other members' edits.
  useEffect(() => {
    if (open && items === null) void load();
  }, [open, items, load]);

  if (!open) {
    return (
      <aside className="border-border bg-card/30 flex w-10 flex-col items-center border-l py-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => setOpen(true)}
          aria-label={tr("folios.activity.open")}
        >
          <History className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => setOpen(true)}
          aria-label={tr("folios.activity.open")}
        >
          <ChevronLeft className="size-4" />
        </Button>
      </aside>
    );
  }

  return (
    <aside className="border-border bg-card/30 flex w-80 flex-col border-l">
      <header className="border-border flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <History className="size-4" />
          <span className="text-sm font-medium">
            {tr("folios.activity.title")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => void load()}
            disabled={loading}
            aria-label={tr("folios.activity.refresh")}
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setOpen(false)}
            aria-label={tr("folios.activity.close")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items === null && loading ? (
          <p className="text-muted-foreground p-4 text-xs">
            {tr("folios.activity.loading")}
          </p>
        ) : items && items.length === 0 ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <History className="size-6 opacity-40" />
            <p className="text-xs">{tr("folios.activity.empty")}</p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {(items ?? []).map((it) => (
              <li
                key={it.id}
                className="border-border/40 flex flex-col gap-0.5 border-b px-3 py-2 text-xs"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="font-medium">
                    {it.byUsername ?? tr("folios.activity.unknownUser")}
                  </span>
                  <span className="text-muted-foreground">
                    {tr(`folios.activity.action.${it.action}`)}
                  </span>
                </div>
                <a
                  href={`/c/${campaign?.id}/archive/${it.folioShortId}`}
                  className="text-primary truncate underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
                  title={it.folioTitle}
                >
                  {it.folioTitle} #{it.folioShortId}
                </a>
                <span className="text-muted-foreground text-[10px]">
                  {dt.of(it.at).fromNow()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
};

export default ArchiveActivityPanel;
