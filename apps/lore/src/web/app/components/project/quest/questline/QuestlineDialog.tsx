import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { useEffect, useState } from "react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import QuestView from "../QuestView.tsx";
import type { QuestlineNode } from "./questlineLayout.ts";

export interface QuestlineDialogProps {
  /** The quest on show, or `null` when the dialog is closed. */
  node: QuestlineNode | null;
  /** Every node on the board, so a neighbour can be resolved by id. */
  nodesById: Map<number, QuestlineNode>;
  onNavigate: (node: QuestlineNode) => void;
  onClose: () => void;
  onQuestChange: (quest: QuestResource) => void;
}

/**
 * The quest, opened over the map.
 *
 * It mounts the real `QuestView` in its `card` context, which is the same
 * component the kanban board's sheet uses, so this surface inherits every
 * improvement made there rather than growing a second quest renderer.
 *
 * Flanking it are the quest's neighbours, named rather than arrowed. One
 * button per link: nothing on a side with no link, a stack on a fork.
 */
const QuestlineDialog = (props: QuestlineDialogProps) => {
  const node = props.node;
  // The neighbours belong to a dialog that has finished arriving. Rendering
  // them with it makes them fly in alongside the panel, which reads as three
  // things appearing rather than one thing opening.
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    if (!node) {
      setLanded(false);
      return;
    }
    const timer = window.setTimeout(() => setLanded(true), OPEN_MS);
    return () => window.clearTimeout(timer);
  }, [node]);

  const neighbours = (ids: number[]): QuestlineNode[] =>
    ids
      .map((id) => props.nodesById.get(id))
      .filter((next): next is QuestlineNode => next != null);

  const prev = node?.prevId != null ? neighbours([node.prevId]) : [];
  const next = node ? neighbours(node.nextIds) : [];

  return (
    <Dialog
      open={node != null}
      onOpenChange={(open) => !open && props.onClose()}
    >
      <DialogContent
        showCloseButton={false}
        className="h-[90vh] w-[min(1060px,calc(100vw-2rem))] max-w-none gap-0 overflow-visible p-0 sm:max-w-none xl:w-[min(1060px,calc(100vw-32rem))]"
      >
        {node && (
          <>
            <DialogTitle className="sr-only">
              #{node.quest.shortId} {node.quest.title}
            </DialogTitle>

            <div className="min-h-0 overflow-y-auto rounded-xl">
              <QuestView
                quest={node.quest}
                context="card"
                onClose={props.onClose}
                onQuestChange={props.onQuestChange}
              />
            </div>

            {landed && (
              <>
                <NeighbourGroup
                  side="prev"
                  nodes={prev}
                  onPick={props.onNavigate}
                />
                <NeighbourGroup
                  side="next"
                  nodes={next}
                  onPick={props.onNavigate}
                />
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default QuestlineDialog;

/** Matches the popup's own open animation, so the two land together. */
const OPEN_MS = 180;

interface NeighbourGroupProps {
  side: "prev" | "next";
  nodes: QuestlineNode[];
  onPick: (node: QuestlineNode) => void;
}

/**
 * Hidden below `xl`, where there is no room beside the panel for a column
 * of names. The quest's own questline row still carries the same links.
 */
const NeighbourGroup = (props: NeighbourGroupProps) => {
  if (props.nodes.length === 0) return null;

  return (
    <div
      className={`animate-in fade-in absolute top-1/2 hidden w-52 -translate-y-1/2 flex-col gap-2 duration-200 xl:flex ${props.side === "prev" ? "-left-[13.5rem]" : "-right-[13.5rem]"}`}
    >
      {props.nodes.map((node) => (
        <button
          key={node.quest.id}
          type="button"
          onClick={() => props.onPick(node)}
          className="bg-popover/95 border-border hover:border-foreground/25 hover:bg-accent focus-visible:outline-primary flex flex-col gap-1.5 rounded-lg border px-3.5 py-3 text-left backdrop-blur transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="text-muted-foreground font-mono text-[10.5px]">
            #{node.quest.shortId}
          </span>
          <span className="line-clamp-3 text-[12.5px] leading-[1.35] font-medium">
            {node.quest.title}
          </span>
        </button>
      ))}
    </div>
  );
};
