import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { DateTimeProvider } from "alepha/datetime";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Bug, Loader2, MoreVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  BlightController,
  BlightResource,
} from "@/api/controllers/BlightController.ts";
import { QUEST_STATUS_PREFIX } from "@/api/entities/sigilBlights.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentBlightCountAtom } from "../../../atoms/currentBlightCountAtom.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface CampaignBlightsProps {
  items: BlightResource[];
  openCount: number;
}

/**
 * Owner-facing Blights inbox.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack` and `sourceUrl` are 100%
 * attacker-controlled. They are rendered ONLY via plain React text
 * interpolation (`{value}`) — React escapes it. NEVER MarkdownView /
 * dangerouslySetInnerHTML. See folio #12.
 */
const CampaignBlights = (props: CampaignBlightsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [campaign] = useStore(currentCampaignAtom);
  const [, setBlightCount] = useStore(currentBlightCountAtom);
  const blightApi = useClient<BlightController>();
  const toaster = useToast();
  const dt = useInject(DateTimeProvider);

  const [showResolved, setShowResolved] = useState(false);
  const [items, setItems] = useState<BlightResource[]>(props.items ?? []);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [stackView, setStackView] = useState<BlightResource | null>(null);

  const reload = async (includeResolved = showResolved) => {
    if (!campaign) return;
    setLoading(true);
    try {
      const res = await blightApi.listBlights({
        params: { campaignId: campaign.id },
        query: { includeResolved },
      });
      setItems(res.items);
      setBlightCount({ count: res.openCount });
    } finally {
      setLoading(false);
    }
  };

  // The route loader already supplied the open-only list for first paint
  // (`props.items`). Skip the first effect run so we don't immediately
  // re-fetch the same data; every later `showResolved` toggle does reload.
  const hasReloaded = useRef(false);
  useEffect(() => {
    if (!hasReloaded.current) {
      hasReloaded.current = true;
      return;
    }
    void reload(showResolved);
  }, [showResolved]);

  const onResolve = async (blight: BlightResource) => {
    if (!campaign) return;
    setBusyId(blight.id);
    try {
      await blightApi.resolveBlight({
        params: { campaignId: campaign.id, blightId: blight.id },
      });
      toaster.success(tr("blights.toast.resolved"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  const onForward = async (blight: BlightResource) => {
    if (!campaign) return;
    setBusyId(blight.id);
    try {
      const res = await blightApi.forwardBlightToQuest({
        params: { campaignId: campaign.id, blightId: blight.id },
      });
      toaster.success(
        tr("blights.toast.forwarded", { args: [String(res.questShortId)] }),
      );
      await reload();
      router.push("campaignQuest", {
        params: {
          campaignId: String(campaign.id),
          shortId: String(res.questShortId),
        },
      });
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (blight: BlightResource) => {
    if (!campaign) return;
    if (!window.confirm(tr("blights.deleteConfirm"))) return;
    setBusyId(blight.id);
    try {
      await blightApi.deleteBlight({
        params: { campaignId: campaign.id, blightId: blight.id },
      });
      toaster.success(tr("blights.toast.deleted"));
      await reload();
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  const renderStatus = (status: string) => {
    if (status === "resolved") {
      return <Badge variant="secondary">{tr("blights.status.resolved")}</Badge>;
    }
    if (status.startsWith(QUEST_STATUS_PREFIX)) {
      return (
        <Badge variant="outline">
          {tr("blights.status.quest", {
            args: [status.slice(QUEST_STATUS_PREFIX.length)],
          })}
        </Badge>
      );
    }
    return null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{tr("blights.title")}</h2>
            {loading && (
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {tr("blights.subtitle")}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={showResolved}
            onCheckedChange={(v) => setShowResolved(v === true)}
          />
          {tr("blights.filter.showResolved")}
        </label>
      </div>

      {items.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
          <Bug className="size-8 opacity-60" />
          <p className="text-sm">
            {showResolved ? tr("blights.empty.resolved") : tr("blights.empty")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="p-2 font-medium">{tr("blights.col.error")}</th>
                <th className="p-2 font-medium">{tr("blights.col.page")}</th>
                <th className="p-2 font-medium">{tr("blights.col.count")}</th>
                <th className="p-2 font-medium">
                  {tr("blights.col.lastSeen")}
                </th>
                <th className="p-2 font-medium">
                  {tr("blights.col.recentIps")}
                </th>
                <th className="p-2 text-right font-medium">
                  {tr("blights.col.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((blight) => {
                const triaged =
                  blight.status === "resolved" ||
                  blight.status.startsWith(QUEST_STATUS_PREFIX);
                return (
                  <tr key={blight.id} className="border-b align-top">
                    <td className="max-w-[420px] p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Attacker-controlled — plain text, escaped by React. */}
                        <span className="font-medium">{blight.name}</span>
                        {renderStatus(blight.status)}
                      </div>
                      <p className="text-muted-foreground line-clamp-2 break-words">
                        {blight.message}
                      </p>
                    </td>
                    <td className="max-w-[260px] p-2">
                      {blight.sourceUrl ? (
                        <span
                          className="text-muted-foreground block truncate text-xs"
                          title={blight.sourceUrl}
                        >
                          {blight.sourceUrl}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="p-2 tabular-nums">{blight.count}</td>
                    <td className="text-muted-foreground p-2 whitespace-nowrap">
                      <span title={formatDate(blight.lastSeenAt)}>
                        {dt.of(blight.lastSeenAt).fromNow()}
                      </span>
                    </td>
                    <td className="text-muted-foreground p-2">
                      {blight.recentIps.length === 0 ? (
                        <span>{tr("blights.noIps")}</span>
                      ) : (
                        <div className="flex flex-col gap-0.5 font-mono text-xs">
                          {blight.recentIps.slice(0, 3).map((ip) => (
                            <span key={ip} className="truncate">
                              {ip.slice(0, 12)}…
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                disabled={busyId === blight.id}
                                aria-label={tr("blights.col.actions")}
                              />
                            }
                          >
                            <MoreVertical className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!triaged && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => void onResolve(blight)}
                                >
                                  {tr("blights.action.resolve")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => void onForward(blight)}
                                >
                                  {tr("blights.action.forward")}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <DropdownMenuItem
                              onClick={() => setStackView(blight)}
                            >
                              {tr("blights.action.viewStack")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => void onDelete(blight)}
                            >
                              {tr("blights.action.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={stackView !== null}
        onOpenChange={(open) => {
          if (!open) setStackView(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {stackView?.name}: {stackView?.message}
            </DialogTitle>
          </DialogHeader>
          {stackView?.sourceUrl && (
            <p className="text-muted-foreground text-xs break-all">
              {stackView.sourceUrl}
            </p>
          )}
          <pre className="bg-muted max-h-[60vh] overflow-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap break-words">
            {stackView?.stack || "—"}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CampaignBlights;
