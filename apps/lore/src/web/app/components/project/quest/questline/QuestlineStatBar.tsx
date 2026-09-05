import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Maximize, Minus, Plus } from "lucide-react";
import { useMemo } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

import type { AreaDotColor } from "../../../shared/areaColor.ts";
import type { QuestlineState, QuestlineTrack } from "./questlineLayout.ts";

export interface QuestlineStatBarProps {
  tracks: QuestlineTrack[];
  areaColor: AreaDotColor;
  /**
   * The viewport's scale and its three controls. The bar sits OUTSIDE the
   * transformed frame, which is why the control lives here: it never scales
   * with the board it is scaling.
   */
  zoom: QuestlineStatBarZoom;
}

/**
 * The one-line answer to "how far are we, and what is this epic made of",
 * with the zoom control at its far end.
 *
 * Every number is counted from the same nodes the board renders, so the
 * header cannot disagree with what is on screen underneath it.
 */
const QuestlineStatBar = (props: QuestlineStatBarProps) => {
  const { tr } = useI18n<I18n, "en">();

  const summary = useMemo(() => {
    const nodes = props.tracks.flatMap((track) => track.nodes);
    const states = new Map<QuestlineState, number>();
    const areas = new Map<string, number>();
    for (const node of nodes) {
      states.set(node.state, (states.get(node.state) ?? 0) + 1);
      const area = node.quest.area;
      if (area) areas.set(area, (areas.get(area) ?? 0) + 1);
    }
    return {
      total: nodes.length,
      states,
      areas: [...areas.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      ),
    };
  }, [props.tracks]);

  return (
    <div className="border-border bg-background/90 sticky top-0 z-10 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b px-6 py-3 backdrop-blur">
      <span className="text-muted-foreground text-xs">
        <b className="text-foreground font-mono text-xs font-medium">
          {summary.total}
        </b>{" "}
        {tr("questline.stat.quests")}
      </span>

      <span className="bg-border h-4 w-px" />

      {COUNTED.map((state) => (
        <span
          key={state}
          className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
        >
          <span className={`size-[7px] shrink-0 rounded-full ${DOT[state]}`} />
          <b className="text-foreground font-mono text-xs font-medium">
            {summary.states.get(state) ?? 0}
          </b>{" "}
          {tr(LABEL[state])}
        </span>
      ))}

      {/* `ml-auto` rather than a flex-1 spacer: a spacer eats the free
          space the legend needs to wrap into, so on a narrow panel the areas
          ran off the edge instead of dropping onto a second line. */}
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {summary.areas.map(([area, count]) => (
          <span
            key={area}
            className="text-muted-foreground inline-flex items-center gap-1.5 text-[11.5px]"
          >
            <span
              className={`size-[7px] shrink-0 rounded-full ${props.areaColor.dotClass(area)}`}
            />
            {area}
            <b className="text-muted-foreground/70 font-mono text-[11px] font-normal">
              {count}
            </b>
          </span>
        ))}
      </span>

      <span
        role="group"
        aria-label={String(tr("questline.zoom.label"))}
        className="inline-flex items-center gap-0.5"
      >
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={String(tr("questline.zoom.out"))}
          onClick={props.zoom.onZoomOut}
        >
          <Minus />
        </Button>
        <span
          data-testid="questline-zoom-level"
          className="text-muted-foreground w-10 text-center font-mono text-[11px] tabular-nums"
        >
          {props.zoom.percent}%
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={String(tr("questline.zoom.in"))}
          onClick={props.zoom.onZoomIn}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={String(tr("questline.zoom.fit"))}
          onClick={props.zoom.onReset}
        >
          <Maximize />
        </Button>
      </span>
    </div>
  );
};

export default QuestlineStatBar;

export interface QuestlineStatBarZoom {
  /**
   * The scale as a whole percentage, which is how the bar prints it.
   */
  percent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /**
   * Back to the fit.
   */
  onReset: () => void;
}

/**
 * Shelved quests are counted into the total but get no chip: they are the
 * deliberate "not doing this", which is not a stage of progress.
 */
const COUNTED = [
  "done",
  "running",
  "ready",
  "waiting",
] as const satisfies readonly QuestlineState[];

type CountedState = (typeof COUNTED)[number];

type StateLabelKey =
  | "questline.state.done"
  | "questline.state.running"
  | "questline.state.ready"
  | "questline.state.waiting";

const LABEL: Record<CountedState, StateLabelKey> = {
  done: "questline.state.done",
  running: "questline.state.running",
  ready: "questline.state.ready",
  waiting: "questline.state.waiting",
};

const DOT: Record<CountedState, string> = {
  done: "bg-emerald-500",
  running: "bg-amber-500",
  ready: "bg-primary",
  waiting: "bg-muted-foreground/35",
};
