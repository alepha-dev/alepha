import type { AreaDotColor } from "../../../shared/areaColor.ts";
import QuestlineCard from "./QuestlineCard.tsx";
import type {
  QuestlineItem,
  QuestlineNode,
  QuestlineTrack as Track,
} from "./questlineLayout.ts";

export interface QuestlineTrackProps<T extends QuestlineItem> {
  track: Track<T>;
  areaColor: AreaDotColor;
  /**
   * Cards are buttons that open the quest over the map.
   */
  onOpen?: (node: QuestlineNode<T>) => void;
  /**
   * Cards are links to wherever this says. See `QuestlineCard`.
   */
  hrefOf?: (node: QuestlineNode<T>) => string;
}

/**
 * One questline: every quest reachable from one root, laid out left to
 * right, with its own edge layer on top.
 *
 * The edges are per track rather than one layer over the whole board, and
 * that is load-bearing rather than tidiness: hovering a quest dims every
 * OTHER questline, and a single shared SVG could not be dimmed row by row.
 * A track is exactly one connected component, so "connected to what I am
 * pointing at" and "in this element" are the same question.
 *
 * The dimming keys on the card's own class rather than on `button:hover`,
 * because the release Flow draws its cards as links.
 */
const QuestlineTrack = <T extends QuestlineItem>(
  props: QuestlineTrackProps<T>,
) => {
  const track = props.track;

  return (
    <div
      className="group/track relative transition-opacity duration-300 group-has-[.questline-card:hover]/board:opacity-50 has-[.questline-card:hover]:opacity-100"
      style={{ width: track.width, height: track.height }}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        width={track.width}
        height={track.height}
        viewBox={`0 0 ${track.width} ${track.height}`}
      >
        <g
          className="stroke-muted-foreground/45"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          fill="none"
        >
          {track.edges.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>

      {track.nodes.map((node) => (
        <div
          key={node.quest.id}
          className="absolute"
          style={{ left: node.x, top: node.y }}
        >
          <QuestlineCard
            node={node}
            areaDotClass={props.areaColor.dotClass(node.quest.area ?? "")}
            onOpen={props.onOpen}
            href={props.hrefOf?.(node)}
          />
        </div>
      ))}
    </div>
  );
};

export default QuestlineTrack;
