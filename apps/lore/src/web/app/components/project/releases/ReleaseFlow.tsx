import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useCallback, useMemo } from "react";

import type { ReleaseContentQuest } from "@/api/schemas/releaseContentQuestSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentAreasAtom } from "@/web/app/atoms/currentAreasAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { AreaDotColor } from "../../shared/areaColor.ts";
import type { QuestlineNode } from "../quest/questline/questlineLayout.ts";
import QuestlineStatBar from "../quest/questline/QuestlineStatBar.tsx";
import { useQuestlineViewport } from "../quest/questline/useQuestlineViewport.ts";
import type { ReleaseContentsData } from "./ReleaseContents.tsx";
import ReleaseFlowCluster from "./ReleaseFlowCluster.tsx";
import { ReleaseFlowLayout } from "./releaseFlowLayout.ts";

export interface ReleaseFlowProps {
  /**
   * What is in the release, fetched by the shell.
   *
   * ⚠️ **This tab does not fetch it, and must not**, for the reason
   * `ReleaseContents` gives: the plate and the tab bar read the same data
   * while another tab is open. `null` means "not loaded yet" and renders
   * nothing rather than an empty state.
   */
  contents: ReleaseContentsData | null;
}

/**
 * The Flow tab of a release: every attached epic as a cluster holding its
 * own questline, with the edges between clusters drawn from
 * `epics.dependsOn`, and the loose quests in a group of their own below.
 *
 * The Contents tab answers "what is in it". This answers "what order does
 * it ship in", at the level a release is actually planned. It reuses the
 * questline's viewport unchanged, which is also the honest test of that
 * hook: a release is several epics wide and unusable without pan and zoom.
 *
 * Cards are links to the quest page rather than triggers for the epic
 * Flow's dialog. That dialog mounts `QuestView` on a full `QuestResource`,
 * and this map is drawn from release-contents rows, which carry what a card
 * shows and nothing more. Shipping whole resources for a map that never
 * reads their bodies is the wrong trade, and the tab must not fetch.
 */
const ReleaseFlow = (props: ReleaseFlowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [areas] = useStore(currentAreasAtom);
  const viewport = useQuestlineViewport();

  const map = useMemo(
    () =>
      props.contents ? new ReleaseFlowLayout().build(props.contents) : null,
    [props.contents],
  );
  const areaColor = useMemo(() => new AreaDotColor(areas), [areas]);
  // The stat bar counts every quest on the map, the loose ones included.
  const tracks = useMemo(
    () =>
      map
        ? [
            ...map.epics.flatMap((group) => group.tracks),
            ...(map.loose?.tracks ?? []),
          ]
        : [],
    [map],
  );
  const hrefOf = useCallback(
    (node: QuestlineNode<ReleaseContentQuest>) =>
      router.path("projectQuest", {
        params: { shortId: String(node.quest.shortId) },
      }),
    [router],
  );

  if (!map) return null;

  if (map.epics.length === 0 && !map.loose) {
    return (
      <div className="text-muted-foreground min-h-0 flex-1 p-6 text-center text-sm">
        {tr("release.flow.empty")}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <QuestlineStatBar
        tracks={tracks}
        areaColor={areaColor}
        zoom={{
          percent: Math.round(viewport.transform.k * 100),
          onZoomIn: viewport.zoomIn,
          onZoomOut: viewport.zoomOut,
          onReset: viewport.reset,
        }}
      />

      {/* The same frame as `Questline`: see the comment there for why it is
          `overflow-clip` and why the board is `absolute`. The board carries
          an explicit size here because every cluster inside it is placed
          absolutely and would otherwise give it none. */}
      <div
        ref={viewport.viewportRef}
        data-dragging={viewport.dragging || undefined}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-clip data-[dragging]:cursor-grabbing data-[dragging]:select-none"
      >
        <div
          ref={viewport.boardRef}
          className="group/board absolute top-0 left-0"
          style={{
            ...viewport.boardStyle,
            width: map.width,
            height: map.height,
          }}
        >
          {/* One layer for the edges BETWEEN clusters. Each cluster's own
              questlines keep their per-track layers, which is what the
              hover dimming needs. */}
          <svg
            data-testid="release-flow-edges"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            width={map.width}
            height={map.height}
            viewBox={`0 0 ${map.width} ${map.height}`}
          >
            <g
              className="stroke-muted-foreground/55"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              fill="none"
            >
              {map.edges.map((d) => (
                <path key={d} d={d} />
              ))}
            </g>
          </svg>

          {map.epics.map((group) => (
            <ReleaseFlowCluster
              key={group.epic.id}
              group={group}
              areaColor={areaColor}
              hrefOf={hrefOf}
              epicHref={router.path("projectEpic", {
                params: { epicNumber: String(group.epic.number) },
              })}
            />
          ))}
          {map.loose && (
            <ReleaseFlowCluster
              group={map.loose}
              areaColor={areaColor}
              hrefOf={hrefOf}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ReleaseFlow;
