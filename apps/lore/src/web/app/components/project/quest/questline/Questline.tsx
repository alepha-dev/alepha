import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo, useState } from "react";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAreasAtom } from "@/web/app/atoms/currentAreasAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";
import QuestlineDialog from "./QuestlineDialog.tsx";
import QuestlineStatBar from "./QuestlineStatBar.tsx";
import QuestlineTrack from "./QuestlineTrack.tsx";
import { QuestlineAreaColor } from "./questlineAreaColor.ts";
import { QuestlineLayout, type QuestlineNode } from "./questlineLayout.ts";

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
 */
const Questline = (props: QuestlineProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [areas] = useStore(currentAreasAtom);
  const [open, setOpen] = useState<QuestlineNode | null>(null);

  const tracks = useMemo(
    () => new QuestlineLayout().build(props.quests),
    [props.quests],
  );
  const areaColor = useMemo(() => new QuestlineAreaColor(areas), [areas]);
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
      <QuestlineStatBar tracks={tracks} areaColor={areaColor} />

      <div className="flex min-h-0 flex-1 overflow-auto p-5">
        {/* `margin: auto` rather than a centring flex alignment: once a
            questline outgrows the panel the margins collapse to zero and it
            scrolls from its top-left instead of having its first cards
            clipped out of reach. */}
        <div className="group/board m-auto flex w-max flex-none flex-col gap-6">
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
        nodesById={nodesById}
        onNavigate={setOpen}
        onClose={() => setOpen(null)}
        onQuestChange={props.onQuestChange}
      />
    </div>
  );
};

export default Questline;
