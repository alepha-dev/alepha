import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import type { ReleaseContentQuest } from "@/api/schemas/releaseContentQuestSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import type { AreaDotColor } from "../../shared/areaColor.ts";
import { formatReference } from "../../shared/element/typedReference.ts";
import {
  type EpicStatus,
  STATUS_ICONS,
  STATUS_LABEL_KEYS,
  STATUS_TONE,
} from "../epics/epicStatus.ts";
import type { QuestlineNode } from "../quest/questline/questlineLayout.ts";
import QuestlineTrack from "../quest/questline/QuestlineTrack.tsx";
import {
  CLUSTER_HEADER,
  CLUSTER_PAD,
  type ReleaseFlowGroup,
  TRACK_GAP,
} from "./releaseFlowLayout.ts";

export interface ReleaseFlowClusterProps {
  group: ReleaseFlowGroup;
  areaColor: AreaDotColor;
  /**
   * Where a card leads: the quest's own page. The map is drawn from
   * release-contents rows, not the resources the epic Flow's dialog needs.
   */
  hrefOf: (node: QuestlineNode<ReleaseContentQuest>) => string;
  /**
   * Where the header leads, for an epic group. The loose group has no page.
   */
  epicHref?: string;
}

/**
 * One box on the release map: an epic and its questline, or the quests in
 * the release under no epic.
 *
 * `ReleaseFlowLayout` sized it, so the header height, the padding and the
 * gap between questlines are read from the constants that did the sizing
 * rather than from Tailwind spacing that could drift from them. The ratio
 * in the header is counted from the rows inside the box, the Contents
 * card's rule: shelved is outside the denominator, because declined work is
 * not work outstanding.
 */
const ReleaseFlowCluster = (props: ReleaseFlowClusterProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { group } = props;
  const nodes = group.tracks.flatMap((track) => track.nodes);
  const completed = nodes.filter((node) => node.state === "done").length;
  const total = nodes.filter((node) => node.state !== "shelved").length;
  const epic = group.epic;
  // `getReleaseContents` types this as a plain string; the three values it
  // can hold are the epic status enum.
  const status = epic?.status as EpicStatus | undefined;
  const StatusIcon = status ? STATUS_ICONS[status] : undefined;

  return (
    <div
      className="bg-card/40 border-border absolute rounded-xl border"
      style={{
        left: group.x,
        top: group.y,
        width: group.width,
        height: group.height,
      }}
    >
      <div
        className="border-border/60 flex items-center gap-2.5 border-b px-4"
        style={{ height: CLUSTER_HEADER }}
      >
        {epic && status ? (
          <>
            <Badge variant="tint" tone={STATUS_TONE[status]}>
              {StatusIcon && <StatusIcon className="size-3" />}
              {tr(STATUS_LABEL_KEYS[status])}
            </Badge>
            {props.epicHref ? (
              <Link
                href={props.epicHref}
                className="min-w-0 flex-1 truncate text-sm font-medium"
              >
                <span className="font-mono">
                  {formatReference("epic", epic.number)}
                </span>
                <span className="text-muted-foreground"> - </span>
                {epic.title}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                <span className="font-mono">
                  {formatReference("epic", epic.number)}
                </span>
                <span className="text-muted-foreground"> - </span>
                {epic.title}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px] font-medium tracking-[0.06em] uppercase">
            {tr("release.contents.noEpic")}
          </span>
        )}
        <span className="text-muted-foreground shrink-0 font-mono text-[11.5px]">
          {completed}/{total}
        </span>
      </div>

      <div
        className="flex flex-col"
        style={{ padding: CLUSTER_PAD, gap: TRACK_GAP }}
      >
        {group.tracks.map((track) => (
          <QuestlineTrack
            key={track.rootId}
            track={track}
            areaColor={props.areaColor}
            hrefOf={props.hrefOf}
          />
        ))}
      </div>
    </div>
  );
};

export default ReleaseFlowCluster;
