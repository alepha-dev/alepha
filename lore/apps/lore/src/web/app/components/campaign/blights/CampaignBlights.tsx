import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { type Page, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Ban, CheckCircle2, FileText, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import type {
  BlightController,
  BlightResource,
} from "@/api/controllers/BlightController.ts";
import { QUEST_STATUS_PREFIX } from "@/api/entities/sigilBlights.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentBlightCountAtom } from "../../../atoms/currentBlightCountAtom.ts";
import { currentCampaignAtom } from "../../../atoms/currentCampaignAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import CampaignBlightRulesDialog from "./CampaignBlightRulesDialog.tsx";

export interface CampaignBlightsProps {
  items: BlightResource[];
  openCount: number;
}

/**
 * Mirrors `RECENT_IPS_CAP` in `BlightIngestService` — the max distinct hashed
 * IPs retained on a blight row. At this count the spread label switches to
 * "N+" because the bounded array may under-count the true reach.
 */
const RECENT_IPS_CAP = 10;

/**
 * Filter form, owned by AlephaTable: a status select (open / resolved / all)
 * and a sigil select (`"all"` or a sigil id). Both filters are applied
 * client-side over the already-fetched list.
 */
const blightsFiltersSchema = t.object({
  status: t.optional(t.enum(["open", "resolved", "all"])),
  sigilId: t.optional(t.string()),
});

/**
 * Owner-facing Blights inbox, built on {@link AlephaTable}.
 *
 * The `listBlights` endpoint returns the full deduplicated list (crashes are
 * folded by root cause, so the row count stays small), so sort + paging are
 * applied client-side here rather than round-tripping the server.
 *
 * ⚠️ SECURITY: `name`, `message`, `stack` and `sourceUrl` are 100%
 * attacker-controlled. They are rendered ONLY via plain React text
 * interpolation (`{value}`) — React escapes it. NEVER MarkdownView /
 * dangerouslySetInnerHTML. See folio #12.
 */
const CampaignBlights = (_props: CampaignBlightsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [campaign] = useStore(currentCampaignAtom);
  const alepha = useAlepha();
  const blightApi = useClient<BlightController>();
  const toaster = useToast();
  const dt = useInject(DateTimeProvider);

  const [stackView, setStackView] = useState<BlightResource | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  // Sigil options for the "filter by sigil" dropdown, hydrated from the list
  // response so members (who can't hit the owner-only sigil list) still get
  // the filter populated.
  const [sigilOptions, setSigilOptions] = useState<
    { id: string; label: string }[]
  >([]);

  // `recentIps` is a privacy-preserving array of salted IP HASHES capped at
  // RECENT_IPS_CAP (10) on ingestion — never raw IPs. The hash prefixes are
  // meaningless to a human, so we surface only the COUNT of distinct hashes as
  // a spread signal. At the cap we show "N+" since the true distinct count may
  // be higher than what the bounded array retains.
  const renderSpread = (count: number) => {
    if (count === 0) return tr("blights.spread.none");
    if (count === 1) return tr("blights.spread.oneIp");
    const key =
      count >= RECENT_IPS_CAP ? "blights.spread.capped" : "blights.spread.ips";
    return tr(key, { args: [String(count)] });
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

  // Fetch the full list, keep the sidebar badge in sync, then sort + slice
  // client-side into the `Page` shape AlephaTable consumes.
  const fetchBlights = async ({
    page,
    size,
    sort,
    filters,
  }: {
    page: number;
    size: number;
    sort?: string;
    filters?: Record<string, any>;
  }): Promise<Page<BlightResource>> => {
    if (!campaign) {
      return emptyPage(page, size);
    }
    // "open" (default) hides resolved/forwarded rows server-side; "resolved"
    // and "all" fetch the full set, with "resolved" narrowed client-side.
    const status = (filters?.status as string) ?? "open";
    const res = await blightApi.listBlights({
      params: { campaignId: campaign.id },
      query: { includeResolved: status !== "open" },
    });
    // Push the freshest open-count to the sidebar badge atom. Write-only:
    // this component never reads the badge, so it must NOT subscribe to it —
    // subscribing here (via useStore) re-rendered this component on every
    // fetch, which (with an inline `fetch` prop) span the table into an
    // infinite refetch loop. `store.set` updates the atom without subscribing.
    alepha.store.set(currentBlightCountAtom, { count: res.openCount });
    setSigilOptions(res.sigils);

    const sigilId = (filters?.sigilId as string) ?? "all";
    const statusFiltered =
      status === "resolved"
        ? res.items.filter((b) => b.status === "resolved")
        : res.items;
    const filtered =
      sigilId === "all"
        ? statusFiltered
        : statusFiltered.filter((b) => b.sigilId === sigilId);
    const rows = sortBlights(filtered, sort);
    const offset = page * size;
    const content = rows.slice(offset, offset + size);
    return {
      content,
      page: {
        number: page,
        size,
        offset,
        numberOfElements: content.length,
        totalElements: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / size)),
        isEmpty: content.length === 0,
        isFirst: page === 0,
        isLast: offset + size >= rows.length,
      },
    };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <AlephaTable<BlightResource>
        className="min-h-0 flex-1"
        defaultSize={20}
        persistenceKey={campaign ? `lor.blights.${campaign.id}` : "lor.blights"}
        defaultSort={{ field: "count", direction: "desc" }}
        emptyMessage={tr("blights.empty")}
        filters={{
          schema: blightsFiltersSchema,
          initialValues: { status: "open", sigilId: "all" },
          render: (form) => (
            <div className="flex gap-2">
              <div className="w-44">
                <Control
                  input={form.input.status}
                  label=""
                  triggerClassName="w-full"
                  items={[
                    { label: tr("blights.filter.open"), value: "open" },
                    { label: tr("blights.filter.resolved"), value: "resolved" },
                    { label: tr("blights.filter.all"), value: "all" },
                  ]}
                />
              </div>
              <div className="w-52">
                <Control
                  input={form.input.sigilId}
                  label=""
                  triggerClassName="w-full"
                  items={[
                    { label: tr("blights.filter.allSigils"), value: "all" },
                    ...sigilOptions.map((s) => ({
                      label: s.label,
                      value: s.id,
                    })),
                  ]}
                />
              </div>
            </div>
          ),
        }}
        fetch={fetchBlights}
        actions={[
          {
            icon: Ban,
            label: tr("blights.rules.title"),
            onClick: () => setRulesOpen(true),
          },
        ]}
        bulkActions={[
          {
            icon: Trash2,
            label: tr("blights.action.deleteSelected"),
            destructive: true,
            onClick: async (selected, { refresh, clearSelection }) => {
              if (!campaign || selected.length === 0) return;
              if (
                !window.confirm(
                  tr("blights.deleteSelectedConfirm", {
                    args: [String(selected.length)],
                  }),
                )
              ) {
                return;
              }
              try {
                const res = await blightApi.deleteBlights({
                  params: { campaignId: campaign.id },
                  body: { ids: selected.map((b) => b.id) },
                });
                toaster.success(
                  tr("blights.toast.deletedMany", {
                    args: [String(res.deleted)],
                  }),
                );
                clearSelection();
                refresh();
              } catch (error) {
                toaster.error(
                  error instanceof Error ? error.message : String(error),
                );
              }
            },
          },
        ]}
        columns={{
          error: {
            label: tr("blights.col.error"),
            className: "max-w-[420px]",
            cell: (b) => (
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Attacker-controlled — plain text, escaped by React. */}
                  <span className="font-medium">{b.name}</span>
                  <Badge
                    variant={b.origin === "server" ? "default" : "outline"}
                  >
                    {tr(`blights.origin.${b.origin}`)}
                  </Badge>
                  {renderStatus(b.status)}
                </div>
                <p className="text-muted-foreground line-clamp-2 break-words">
                  {b.message}
                </p>
              </div>
            ),
          },
          page: {
            label: tr("blights.col.page"),
            className: "max-w-[260px]",
            cell: (b) =>
              b.sourceUrl ? (
                <span
                  className="text-muted-foreground block truncate text-xs"
                  title={b.sourceUrl}
                >
                  {b.sourceUrl}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              ),
          },
          count: {
            label: tr("blights.col.count"),
            sortable: true,
            align: "right",
            cell: (b) => <span className="tabular-nums">{b.count}</span>,
          },
          lastSeenAt: {
            label: tr("blights.col.lastSeen"),
            sortable: true,
            cell: (b) => (
              <span
                className="text-muted-foreground whitespace-nowrap"
                title={formatDate(b.lastSeenAt)}
              >
                {dt.of(b.lastSeenAt).fromNow()}
              </span>
            ),
          },
          spread: {
            label: tr("blights.col.spread"),
            align: "right",
            cell: (b) => (
              <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                {renderSpread(b.recentIps.length)}
              </span>
            ),
          },
        }}
        rowActions={(b) => {
          const triaged =
            b.status === "resolved" || b.status.startsWith(QUEST_STATUS_PREFIX);
          return [
            {
              icon: FileText,
              label: tr("blights.action.viewStack"),
              onClick: () => setStackView(b),
            },
            ...(triaged
              ? []
              : [
                  {
                    icon: CheckCircle2,
                    label: tr("blights.action.resolve"),
                    onClick: async (
                      blight: BlightResource,
                      { refresh }: { refresh: () => void },
                    ) => {
                      if (!campaign) return;
                      try {
                        await blightApi.resolveBlight({
                          params: {
                            campaignId: campaign.id,
                            blightId: blight.id,
                          },
                        });
                        toaster.success(tr("blights.toast.resolved"));
                        refresh();
                      } catch (error) {
                        toaster.error(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    },
                  },
                  {
                    icon: Send,
                    label: tr("blights.action.forward"),
                    onClick: async (
                      blight: BlightResource,
                      { refresh }: { refresh: () => void },
                    ) => {
                      if (!campaign) return;
                      try {
                        const res = await blightApi.forwardBlightToQuest({
                          params: {
                            campaignId: campaign.id,
                            blightId: blight.id,
                          },
                        });
                        toaster.success(
                          tr("blights.toast.forwarded", {
                            args: [String(res.questShortId)],
                          }),
                        );
                        refresh();
                        router.push("campaignQuest", {
                          params: {
                            campaignId: String(campaign.id),
                            shortId: String(res.questShortId),
                          },
                        });
                      } catch (error) {
                        toaster.error(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    },
                  },
                ]),
            {
              icon: Trash2,
              label: tr("blights.action.delete"),
              destructive: true,
              onClick: async (
                blight: BlightResource,
                { refresh }: { refresh: () => void },
              ) => {
                if (!campaign) return;
                if (!window.confirm(tr("blights.deleteConfirm"))) return;
                try {
                  await blightApi.deleteBlight({
                    params: { campaignId: campaign.id, blightId: blight.id },
                  });
                  toaster.success(tr("blights.toast.deleted"));
                  refresh();
                } catch (error) {
                  toaster.error(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              },
            },
          ];
        }}
      />

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

      {campaign && (
        <CampaignBlightRulesDialog
          open={rulesOpen}
          campaignId={campaign.id}
          onOpenChange={setRulesOpen}
        />
      )}
    </div>
  );
};

export default CampaignBlights;

/** Format an ISO timestamp for the `title` tooltip, falling back to raw. */
const formatDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/**
 * Client-side sort over the deduped blight list. Supports the two sortable
 * columns (`count`, `lastSeenAt`); anything else falls back to count desc.
 */
const sortBlights = (
  items: BlightResource[],
  sort?: string,
): BlightResource[] => {
  const field = sort?.replace(/^-/, "") ?? "count";
  const dir = sort?.startsWith("-") ? -1 : 1;
  const rows = [...items];
  rows.sort((a, b) => {
    if (field === "lastSeenAt") {
      return (
        (new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime()) *
        dir
      );
    }
    // Default + explicit `count`.
    return (a.count - b.count) * (sort ? dir : -1);
  });
  return rows;
};

/** Empty `Page` returned before the campaign atom is hydrated. */
const emptyPage = (page: number, size: number): Page<BlightResource> => ({
  content: [],
  page: {
    number: page,
    size,
    offset: page * size,
    numberOfElements: 0,
    totalElements: 0,
    totalPages: 1,
    isEmpty: true,
    isFirst: page === 0,
    isLast: true,
  },
});
