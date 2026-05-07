import { Badge } from "@alepha/ui/components/ui/badge";
import { Sheet, SheetContent } from "@alepha/ui/components/ui/sheet";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { KanbanController } from "@/api/controllers/KanbanController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { Campaign } from "@/api/entities/campaigns.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import {
  kanbanCampaignAtom,
  kanbanReloadAtom,
} from "../../atoms/kanbanCampaignAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { Toaster } from "../../services/Toaster.ts";
import QuestView from "../campaign/quest/QuestView.tsx";
import KanbanColumn from "./KanbanColumn.tsx";

type QuestStatus = "new" | "accepted" | "completed";

export interface KanbanBoardProps {
  campaign: Campaign;
  quests: QuestResource[];
  readOnly: boolean;
}

const KanbanBoard = (props: KanbanBoardProps) => {
  const { campaign, quests: initialQuests, readOnly } = props;
  const [quests, setQuests] = useState<QuestResource[]>(initialQuests);
  const [zoneFilter, setZoneFilter] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedQuest, setSelectedQuest] = useState<QuestResource | null>(
    null,
  );
  const [, setKanbanCampaign] = useStore(kanbanCampaignAtom);
  const [reloadKey] = useStore(kanbanReloadAtom);
  const questApi = useClient<QuestController>();
  const kanbanApi = useClient<KanbanController>();
  const { tr } = useI18n<I18n, "en">();
  const toaster = useInject(Toaster);
  const dndId = useId();

  useEffect(() => {
    setKanbanCampaign({ campaign, readOnly });
    return () => setKanbanCampaign(undefined as any);
  }, [campaign, readOnly]);

  useEffect(() => {
    if (reloadKey?.key) reload();
  }, [reloadKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const toggleZone = useCallback((zone: string) => {
    setZoneFilter((prev) =>
      prev.includes(zone) ? prev.filter((z) => z !== zone) : [...prev, zone],
    );
  }, []);

  const filteredQuests = useMemo(() => {
    if (zoneFilter.length > 0) {
      return quests.filter((quest) => zoneFilter.includes(quest.zone));
    }
    return quests;
  }, [quests, zoneFilter]);

  const grouped = useMemo(() => {
    const result: Record<QuestStatus, QuestResource[]> = {
      new: [],
      accepted: [],
      completed: [],
    };
    for (const quest of filteredQuests) {
      result[quest.metadata.status].push(quest);
    }
    result.completed.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return result;
  }, [filteredQuests]);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await kanbanApi.getBoard({
        params: { campaignId: campaign.id },
      });
      setQuests(data.quests);
    } finally {
      setLoading(false);
    }
  };

  const closeDrawer = () => {
    setSelectedQuest(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const questData = active.data.current;
    const columnData = over.data.current;
    if (questData?.type !== "quest" || columnData?.type !== "column") return;

    const quest = questData.quest as QuestResource;
    const fromStatus = quest.metadata.status;
    const toStatus = columnData.status as QuestStatus;

    if (fromStatus === toStatus) return;

    if (fromStatus === "completed") {
      toaster.show(String(tr("kanban.error.completedCannotMove")), "danger");
      return;
    }

    if (fromStatus === "new" && toStatus === "completed") {
      toaster.show(String(tr("kanban.error.acceptFirst")), "warning");
      return;
    }

    try {
      if (fromStatus === "new" && toStatus === "accepted") {
        await questApi.acceptQuest({ params: { id: quest.id } });
      } else if (fromStatus === "accepted" && toStatus === "new") {
        await questApi.abandonQuest({ params: { id: quest.id } });
      } else if (fromStatus === "accepted" && toStatus === "completed") {
        await questApi.completeQuest({ params: { id: quest.id } });
      }
      await reload();
    } catch (error: any) {
      toaster.show(
        error?.message || String(tr("kanban.error.actionFailed")),
        "danger",
      );
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Filter nav */}
      <div className="flex items-center gap-2 border-border border-b bg-card px-3 py-1.5">
        {readOnly && (
          <Badge variant="secondary" className="text-xs">
            {tr("kanban.readOnly")}
          </Badge>
        )}
        {loading && (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        )}
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {campaign.zones.map((zone) => {
            const active = zoneFilter.includes(zone);
            return (
              <button
                key={zone}
                type="button"
                onClick={() => toggleZone(zone)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  active
                    ? "border-border bg-muted text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {zone}
              </button>
            );
          })}
        </div>
      </div>

      {/* Columns */}
      <div className="flex flex-1 overflow-hidden">
        <DndContext id={dndId} sensors={sensors} onDragEnd={handleDragEnd}>
          <KanbanColumn
            status="new"
            quests={grouped.new}
            readOnly={readOnly}
            onSelect={setSelectedQuest}
          />
          <KanbanColumn
            status="accepted"
            quests={grouped.accepted}
            readOnly={readOnly}
            onSelect={setSelectedQuest}
          />
          <KanbanColumn
            status="completed"
            quests={grouped.completed}
            readOnly={readOnly}
            onSelect={setSelectedQuest}
            last
          />
        </DndContext>
      </div>

      {/* Quest detail sheet */}
      <Sheet
        open={!!selectedQuest}
        onOpenChange={(open) => !open && closeDrawer()}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full p-0 sm:max-w-2xl"
        >
          {selectedQuest && (
            <QuestView
              quest={selectedQuest}
              onClose={closeDrawer}
              onQuestChange={(updated) => {
                setSelectedQuest(updated);
                setQuests((prev) =>
                  prev.map((t) => (t.id === updated.id ? updated : t)),
                );
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default KanbanBoard;
