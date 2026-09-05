import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useEffect, useMemo, useState } from "react";

import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAreasAtom } from "@/web/app/atoms/currentAreasAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { AreaDotColor } from "../../../shared/areaColor.ts";
import { preloadQuestView } from "../LazyQuestView.tsx";
import QuestlineDialog from "./QuestlineDialog.tsx";
import { QuestlineLayout, type QuestlineNode } from "./questlineLayout.ts";
import QuestlineStatBar from "./QuestlineStatBar.tsx";
import QuestlineTrack from "./QuestlineTrack.tsx";
import { useQuestlineViewport } from "./useQuestlineViewport.ts";

export interface QuestlineProps {
  /**
   * The quests to lay out. The caller has already fetched them, and this
   * component deliberately does no fetching of its own: the surface it
   * replaced kept a second copy of the project's graph and polled it, which
   * is how one browser tab spent 51 minutes at 1 request per second.
   */
  quests: QuestResource[];
  onQuestChange: (quest: QuestResource) => void;
}

/**
 * The questline map: one row per `dependsOn` tree, and nothing else.
 *
 * There are no groups above the rows, because the schema has none. A
 * questline is a root and everything downstream of it, which is a fact the
 * data supports; anything above that would be editorial.
 *
 * The board is navigated by dragging and zooming, not by scrolling. It
 * already places every card in absolute coordinates inside a fixed-size
 * box, which is exactly the shape a single transform layer wants: nothing
 * inside the board changed when the scroller became a viewport.
 */
const Questline = (props: QuestlineProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [areas] = useStore(currentAreasAtom);
  const [open, setOpen] = useState<QuestlineNode<QuestResource> | null>(null);
  const viewport = useQuestlineViewport();

  // The dialog mounts `QuestView` behind a chunk boundary, and it opens on a
  // click. Warm it while the map is being read so the click lands on a chunk
  // that is already in the module cache.
  useEffect(() => {
    preloadQuestView();
  }, []);

  // A resource keeps its status under `metadata`; the release Flow's rows
  // keep theirs as timestamps. The layout asks rather than assumes.
  const tracks = useMemo(
    () =>
      new QuestlineLayout<QuestResource>(
        (quest) => quest.metadata.status,
      ).build(props.quests),
    [props.quests],
  );
  const areaColor = useMemo(() => new AreaDotColor(areas), [areas]);
  const nodesById = useMemo(
    () =>
      new Map(
        tracks
          .flatMap((track) => track.nodes)
          .map((node) => [node.quest.id, node]),
      ),
    [tracks],
  );

  // The open dialog holds a node from a previous layout pass, so re-resolve
  // it: without this, editing a quest leaves the dialog showing the version
  // it was opened with while the board underneath has already moved on.
  const current = open ? (nodesById.get(open.quest.id) ?? null) : null;

  if (tracks.length === 0) {
    return (
      <div className="text-muted-foreground min-h-0 flex-1 p-6 text-center text-sm">
        {tr("epic.flow.empty")}
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

      {/* `overflow-clip`, not `overflow-hidden`: hidden is still a scroll
          container, so focusing a card outside the frame would scroll it
          under the transform and the next pan would jump. Clip cannot
          scroll, and the hook pans a focused card into view instead.
          `touch-none` hands touch drags to the pointer handlers rather than
          to the page. The board itself is `absolute` so the frame's size is
          its own and never the board's, which is what keeps the fit honest
          on a 16-card questline. */}
      <div
        ref={viewport.viewportRef}
        data-dragging={viewport.dragging || undefined}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-clip data-[dragging]:cursor-grabbing data-[dragging]:select-none"
      >
        <div
          ref={viewport.boardRef}
          className="group/board absolute top-0 left-0 flex w-max flex-col gap-6"
          style={viewport.boardStyle}
        >
          {tracks.map((track) => (
            <QuestlineTrack
              key={track.rootId}
              track={track}
              areaColor={areaColor}
              onOpen={setOpen}
            />
          ))}
        </div>
      </div>

      <QuestlineDialog
        node={current}
        onClose={() => setOpen(null)}
        onQuestChange={props.onQuestChange}
      />
    </div>
  );
};

export default Questline;
