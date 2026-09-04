import { useI18n } from "alepha/react/i18n";
import { Archive, Check, CircleDot, Lock, Play } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

import { formatReference } from "../../../shared/element/typedReference.ts";
import {
  CARD_H,
  CARD_W,
  type QuestlineNode,
  type QuestlineState,
} from "./questlineLayout.ts";

export interface QuestlineCardProps {
  node: QuestlineNode;
  /**
   * Tailwind class for the area dot, resolved from `areas.color`.
   */
  areaDotClass: string;
  onOpen: (node: QuestlineNode) => void;
}

/**
 * One quest on the map.
 *
 * It deliberately carries no description: the questline answers "what is
 * there and what is stuck behind what", and the body is one click away in
 * the quest itself. What it does carry is the area, which is the metadata
 * that tells you what an epic is actually made of.
 *
 * Status lives on the top edge rather than the left, so the left and right
 * edges stay clear for the connection handles.
 */
const QuestlineCard = (props: QuestlineCardProps) => {
  const { tr } = useI18n<I18n, "en">();
  const node = props.node;
  const Icon = STATE_ICON[node.state];

  return (
    <button
      type="button"
      onClick={() => props.onOpen(node)}
      style={{ width: CARD_W, height: CARD_H }}
      aria-label={`${formatReference("quest", node.quest.shortId)} ${node.quest.title}`}
      className={`group/card focus-visible:outline-primary relative flex flex-col gap-2 rounded-lg border px-3.5 pt-[15px] pb-3 text-left transition-[transform,background-color,border-color] hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 ${STATE_CARD[node.state]}`}
    >
      {/* Status band across the top edge, following the card's radius. */}
      <span
        className={`pointer-events-none absolute -top-px -right-px -left-px h-[3px] rounded-t-lg ${STATE_BAND[node.state]}`}
      />

      {/* A handle exists only where an edge actually lands, so a root has no
          inbound dot and a leaf has no outbound one. */}
      {node.prevId != null && <Handle side="in" state={node.state} />}
      {node.nextIds.length > 0 && <Handle side="out" state={node.state} />}

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-mono text-[11.5px]">
          {formatReference("quest", node.quest.shortId)}
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px]">
          <span
            className={`size-[7px] shrink-0 rounded-full ${props.areaDotClass}`}
          />
          {node.quest.area}
        </span>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 text-[10.5px] ${STATE_TEXT[node.state]}`}
        >
          <Icon className="size-[11px] shrink-0" />
          {tr(STATE_LABEL[node.state])}
        </span>
      </div>

      <div
        className={`line-clamp-3 text-[13px] leading-[1.34] font-semibold ${node.state === "waiting" || node.state === "shelved" ? "text-foreground/60" : ""}`}
      >
        {node.quest.title}
      </div>
    </button>
  );
};

export default QuestlineCard;

interface HandleProps {
  side: "in" | "out";
  state: QuestlineState;
}

/**
 * A connection port, centred on the card's edge. Purely decorative today;
 * it is also where a drag-to-link gesture would start.
 */
const Handle = (props: HandleProps) => (
  <span
    aria-hidden="true"
    className={`bg-background pointer-events-none absolute top-1/2 size-[9px] -translate-y-1/2 rounded-full border-[1.5px] transition-colors ${props.side === "in" ? "-left-[5px]" : "-right-[5px]"} ${STATE_HANDLE[props.state]}`}
  />
);

type StateLabelKey =
  | "questline.state.done"
  | "questline.state.running"
  | "questline.state.ready"
  | "questline.state.waiting"
  | "questline.state.shelved";

const STATE_LABEL: Record<QuestlineState, StateLabelKey> = {
  done: "questline.state.done",
  running: "questline.state.running",
  ready: "questline.state.ready",
  waiting: "questline.state.waiting",
  shelved: "questline.state.shelved",
};

const STATE_ICON: Record<
  QuestlineState,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  done: Check,
  running: Play,
  ready: CircleDot,
  waiting: Lock,
  shelved: Archive,
};

const STATE_CARD: Record<QuestlineState, string> = {
  done: "bg-card border-border hover:bg-accent/40",
  running: "bg-card border-amber-500/30 hover:bg-accent/40",
  ready: "bg-card border-border ring-1 ring-primary/45 hover:bg-accent/40",
  waiting: "bg-card/40 border-border border-dashed hover:bg-accent/30",
  shelved:
    "bg-card/30 border-border border-dashed opacity-70 hover:bg-accent/20",
};

const STATE_BAND: Record<QuestlineState, string> = {
  done: "bg-emerald-500",
  running: "bg-amber-500",
  ready: "bg-primary",
  waiting: "bg-muted-foreground/25",
  shelved: "bg-muted-foreground/15",
};

const STATE_TEXT: Record<QuestlineState, string> = {
  done: "text-emerald-500",
  running: "text-amber-500",
  ready: "text-primary",
  waiting: "text-muted-foreground/70",
  shelved: "text-muted-foreground/60",
};

const STATE_HANDLE: Record<QuestlineState, string> = {
  done: "border-emerald-500/60",
  running: "border-amber-500/60",
  ready: "border-primary/70",
  waiting: "border-muted-foreground/35",
  shelved: "border-muted-foreground/25",
};
