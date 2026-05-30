import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import { Button } from "@alepha/ui/components/ui/button";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouterState } from "alepha/react/router";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

type Status = "new" | "accepted" | "completed";

interface ChainQuest {
  id: number;
  shortId: number;
  title: string;
  status: Status;
  dependsOn?: number;
  /** Depth in the chain — longest-path from any root. Drives the step number. */
  step: number;
}

/**
 * BFS the connected `dependsOn` component reachable from `focusedId`
 * (transitive predecessors + dependents). Returns the filtered quest
 * list and edge maps for the caller.
 */
const collectChain = (
  quests: {
    id: number;
    shortId: number;
    title: string;
    status: Status;
    dependsOn?: number;
  }[],
  focusedId: number,
) => {
  const byId = new Map(quests.map((q) => [q.id, q]));
  const dependentsOf = new Map<number, number[]>();
  for (const q of quests) {
    if (q.dependsOn != null) {
      const list = dependentsOf.get(q.dependsOn) ?? [];
      list.push(q.id);
      dependentsOf.set(q.dependsOn, list);
    }
  }
  const seen = new Set<number>([focusedId]);
  const queue: number[] = [focusedId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (!node) continue;
    if (node.dependsOn != null && !seen.has(node.dependsOn)) {
      seen.add(node.dependsOn);
      queue.push(node.dependsOn);
    }
    for (const dep of dependentsOf.get(id) ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  const subset = quests.filter((q) => seen.has(q.id));

  // Longest-path depth (best-effort topo): each node's step = max(step
  // of any predecessor) + 1. Roots (no dependsOn within the subset)
  // sit at step 1. Iterate until stable — bounded by subset size.
  const inSubset = new Set(subset.map((q) => q.id));
  const stepOf = new Map<number, number>();
  for (const q of subset) stepOf.set(q.id, 1);
  let changed = true;
  let guard = subset.length + 1;
  while (changed && guard-- > 0) {
    changed = false;
    for (const q of subset) {
      if (q.dependsOn != null && inSubset.has(q.dependsOn)) {
        const next = (stepOf.get(q.dependsOn) ?? 1) + 1;
        if (next !== stepOf.get(q.id)) {
          stepOf.set(q.id, next);
          changed = true;
        }
      }
    }
  }

  const chain: ChainQuest[] = subset.map((q) => ({
    ...q,
    step: stepOf.get(q.id) ?? 1,
  }));
  return chain;
};

const statusDot = (status: Status): string => {
  if (status === "completed") return "bg-emerald-500";
  if (status === "accepted") return "bg-amber-500";
  return "bg-muted-foreground/40";
};

interface DescriptionState {
  shortId: number;
  title: string;
  description: string;
}

const QuestGraph = () => {
  const { tr } = useI18n<I18n, "en">();
  const routerState = useRouterState();
  const shortId = Number(routerState.params.shortId);
  const [campaign] = useStore(currentCampaignAtom);
  const questApi = useClient<QuestController>();

  const [allQuests, setAllQuests] = useState<
    {
      id: number;
      shortId: number;
      title: string;
      status: Status;
      dependsOn?: number;
    }[]
  >([]);
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [details, setDetails] = useState<DescriptionState | null>(null);

  const reload = useCallback(async () => {
    if (!campaign?.id) return;
    const rows = await questApi.getDependencyGraph({
      params: { campaignId: campaign.id },
    });
    setAllQuests(rows);
  }, [campaign?.id, questApi]);

  useEffect(() => {
    void reload();
  }, [reload, tick]);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const chain = useMemo(() => {
    const focused = allQuests.find((q) => q.shortId === shortId);
    if (!focused) return [] as ChainQuest[];
    return collectChain(allQuests, focused.id);
  }, [allQuests, shortId]);

  // Default selection: the focused quest (the URL one).
  useEffect(() => {
    if (selectedId != null) return;
    const focused = chain.find((q) => q.shortId === shortId);
    if (focused) setSelectedId(focused.id);
  }, [chain, shortId, selectedId]);

  // Fetch the full description when selection changes. The chain
  // endpoint only carries the title/status/dependsOn — pull the body
  // lazily so a 50-quest chain doesn't pay for content it won't show.
  useEffect(() => {
    if (selectedId == null || !campaign?.id) return;
    const target = chain.find((q) => q.id === selectedId);
    if (!target) return;
    let alive = true;
    questApi
      .getQuestByShortId({
        params: { campaignId: campaign.id, shortId: target.shortId },
      })
      .then((q) => {
        if (alive)
          setDetails({
            shortId: q.shortId,
            title: q.title,
            description: q.description ?? "",
          });
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [selectedId, chain, campaign?.id, questApi]);

  // Flat chain list for the left rail. Sorted by step (best-effort
  // topo) then shortId so siblings keep stable order across reloads.
  const ordered = useMemo(() => {
    return [...chain].sort((a, b) => a.step - b.step || a.shortId - b.shortId);
  }, [chain]);

  // Three-row context window around the SELECTED quest:
  //   prev → predecessor (via dependsOn).
  //   current → selected + siblings (peers that share the same
  //             predecessor — or other root-level quests when selected
  //             is a root itself).
  //   next → direct dependents of selected.
  // Empty rows are hidden by the renderer below.
  const view = useMemo(() => {
    const selected = chain.find((q) => q.id === selectedId);
    if (!selected) {
      return {
        prev: [] as ChainQuest[],
        current: [] as ChainQuest[],
        next: [] as ChainQuest[],
      };
    }
    const prev = chain.filter((q) => q.id === selected.dependsOn);
    const current = chain.filter(
      (q) => q.dependsOn === selected.dependsOn || q.id === selected.id,
    );
    // Stable order — selected first, siblings after by shortId.
    current.sort((a, b) => {
      if (a.id === selected.id) return -1;
      if (b.id === selected.id) return 1;
      return a.shortId - b.shortId;
    });
    const next = chain
      .filter((q) => q.dependsOn === selected.id)
      .sort((a, b) => a.shortId - b.shortId);
    return { prev, current, next };
  }, [chain, selectedId]);

  const handlePick = (q: ChainQuest) => {
    setSelectedId(q.id);
  };

  if (!campaign) return null;

  const selected = chain.find((q) => q.id === selectedId);

  return (
    <div className="flex h-full">
      {/* Left rail — back button + flat ordered list of every quest in
          the chain. Click any to re-center the timeline. */}
      <aside className="border-border bg-card/30 flex w-64 shrink-0 flex-col border-r">
        <div className="p-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            render={<Link href={`/c/${campaign.id}/q/${shortId}`} />}
          >
            <ArrowLeft className="size-4" />
          </Button>
        </div>
        <ol className="flex flex-col gap-0.5 overflow-y-auto px-3 pb-4">
          {ordered.map((q, idx) => {
            const isSelected = q.id === selectedId;
            const isFocused = q.shortId === shortId;
            return (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => handlePick(q)}
                  className={`hover:bg-muted/50 flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm ${
                    isSelected ? "bg-muted font-medium" : ""
                  } ${isFocused ? "text-primary" : ""}`}
                >
                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    {idx + 1}.
                  </span>
                  <span className="truncate">{q.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      {/* 50/50 split of the remaining space: timeline | description.
          No border between selected row and the quickview — only PREV
          and NEXT carry the right-side border, with their inner
          corners rounded away from the selected row so the middle
          row visually merges into the description card. */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-1/2 flex-col">
          <TimelineWindow
            view={view}
            selectedId={selectedId}
            focusedShortId={shortId}
            campaignId={campaign.id}
            onPick={handlePick}
            chainEmpty={chain.length === 0}
            emptyLabel={tr("quest.graph.empty")}
          />
        </div>

        <aside className="flex w-1/2 flex-col overflow-y-auto p-6">
          {selected && details ? (
            <div className="flex flex-1 flex-col">
              <div className="text-muted-foreground mb-1 font-mono text-[11px]">
                #{selected.shortId}
              </div>
              <h2 className="mb-3 text-base font-semibold">{selected.title}</h2>
              {details.description ? (
                <div className="text-foreground/80 text-sm">
                  <MarkdownView content={details.description} />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm italic">
                  {tr("quest.graph.noDescription")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm italic">
              {tr("quest.graph.pickAQuest")}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
};

interface TimelineWindowProps {
  view: {
    prev: ChainQuest[];
    current: ChainQuest[];
    next: ChainQuest[];
  };
  selectedId: number | null;
  focusedShortId: number;
  campaignId: number;
  onPick: (q: ChainQuest) => void;
  chainEmpty: boolean;
  emptyLabel: string;
}

/**
 * Three equal-height rows: previous / selected / next. Each row claims
 * exactly 33% of the column so the layout doesn't reflow when prev or
 * next is empty (rows just render as empty placeholders).
 *
 * - prev row: text tag "previous" on the left, list of predecessors.
 * - selected row: no tag — this is the visual anchor. The middle
 *   always shows exactly ONE quest (the selected one); a "View Quest"
 *   link sits under its title.
 * - next row: text tag "next" on the left, list of dependents.
 *
 * Click any quest in prev/next → re-centers the view on that quest.
 */
const TimelineWindow = (props: TimelineWindowProps) => {
  const { view: w, selectedId, focusedShortId, campaignId, onPick } = props;

  if (props.chainEmpty) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-muted-foreground text-sm italic">
          {props.emptyLabel}
        </p>
      </div>
    );
  }

  const selected = w.current.find((q) => q.id === selectedId) ?? w.current[0];

  const renderQuestPill = (q: ChainQuest) => {
    const isSelected = q.id === selectedId;
    const isFocused = q.shortId === focusedShortId;
    return (
      <button
        key={q.id}
        type="button"
        onClick={() => onPick(q)}
        className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors ${
          isSelected ? "bg-muted font-medium" : "hover:bg-muted/40"
        }`}
      >
        <span
          className={`size-2 shrink-0 rounded-full ${statusDot(q.status)}`}
        />
        <span className={isFocused ? "text-primary font-semibold" : ""}>
          {q.title}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-1 flex-col">
      {/* Previous row — 33%. Right edge borders + bottom-right corner
          rounded so the line peels away from the selected row. */}
      <div className="border-border flex h-1/3 min-h-0 flex-col gap-2 overflow-y-auto rounded-br-lg border-r border-b p-6">
        <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
          previous
        </span>
        {w.prev.length > 0 ? (
          <div className="flex flex-col gap-1">
            {w.prev.map(renderQuestPill)}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs italic">—</span>
        )}
      </div>

      {/* Selected row — 33%. No right border so it visually merges
          into the description card on the right. */}
      <div className="flex h-1/3 min-h-0 flex-col items-center justify-center overflow-y-auto p-6">
        {selected ? (
          <Link
            href={`/c/${campaignId}/q/${selected.shortId}`}
            className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/40"
          >
            <span
              className={`size-2.5 shrink-0 rounded-full ${statusDot(selected.status)}`}
            />
            <span
              className={`text-base font-semibold underline decoration-dotted underline-offset-4 ${
                selected.shortId === focusedShortId ? "text-primary" : ""
              }`}
            >
              {selected.title}
            </span>
          </Link>
        ) : (
          <span className="text-muted-foreground text-xs italic">—</span>
        )}
      </div>

      {/* Next row — 33%. Right edge borders + top-right corner
          rounded, mirroring previous. */}
      <div className="border-border flex h-1/3 min-h-0 flex-col gap-2 overflow-y-auto rounded-tr-lg border-r border-t p-6">
        <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider">
          next
        </span>
        {w.next.length > 0 ? (
          <div className="flex flex-col gap-1">
            {w.next.map(renderQuestPill)}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs italic">—</span>
        )}
      </div>
    </div>
  );
};

export default QuestGraph;
