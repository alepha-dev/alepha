import { Control } from "@alepha/ui/components/control/control";
import { Sheet, SheetContent } from "@alepha/ui/components/ui/sheet";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { z } from "alepha";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useFieldValue, useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { KanbanController } from "@/api/controllers/KanbanController.ts";
import type { QuestController } from "@/api/controllers/QuestController.ts";
import type { ProjectResource } from "@/api/schemas/projectResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import { currentAssignedQuestsAtom } from "../../atoms/currentAssignedQuestsAtom.ts";
import {
  kanbanProjectAtom,
  kanbanReloadAtom,
} from "../../atoms/kanbanProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import QuestView from "../project/quest/QuestView.tsx";
import KanbanColumn, {
  type ColumnDescriptor,
  type ColumnKind,
} from "./KanbanColumn.tsx";

type QuestStatus = "new" | "accepted" | "completed";

const SUB_COLUMN_DOTS = [
  "bg-orange-500",
  "bg-amber-500",
  "bg-yellow-500",
  "bg-lime-500",
  "bg-teal-500",
];

export interface KanbanBoardProps {
  project: ProjectResource;
  quests: QuestResource[];
}

const KanbanBoard = (props: KanbanBoardProps) => {
  const { project, quests: initialQuests } = props;
  const alepha = useAlepha();
  const [quests, setQuests] = useState<QuestResource[]>(initialQuests);
  const [loading, setLoading] = useState(false);
  const areaOptions = useMemo(
    () => (project.areas ?? []).map((z) => ({ value: z, label: z })),
    [project.areas],
  );
  const filterForm = useForm({
    schema: z.object({
      areas: z.array(z.text()),
      tags: z.array(z.text()),
    }),
    initialValues: { areas: [] as string[], tags: [] as string[] },
    handler: async () => {},
  });
  const [areaFilterValue] = useFieldValue(filterForm.input.areas);
  const areaFilter = (areaFilterValue as string[] | undefined) ?? [];
  const [tagFilterValue] = useFieldValue(filterForm.input.tags);
  const tagFilter = (tagFilterValue as string[] | undefined) ?? [];
  const [knownTags, setKnownTags] = useState<string[]>([]);
  useEffect(() => {
    if (!project?.id) return;
    questApi
      .listQuestTags({ query: { projectId: project.id } })
      .then(setKnownTags)
      .catch(() => null);
  }, [project?.id]);
  const [selectedQuest, setSelectedQuest] = useState<QuestResource | null>(
    null,
  );
  const [, setKanbanProject] = useStore(kanbanProjectAtom);
  const [reloadKey] = useStore(kanbanReloadAtom);
  const questApi = useClient<QuestController>();
  const kanbanApi = useClient<KanbanController>();
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dndId = useId();

  useEffect(() => {
    setKanbanProject({ project });
    return () => setKanbanProject(undefined as any);
  }, [project]);

  useEffect(() => {
    if (reloadKey?.key) reload();
  }, [reloadKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const filteredQuests = useMemo(() => {
    let out = quests;
    if (areaFilter.length > 0) {
      out = out.filter((quest) => areaFilter.includes(quest.area));
    }
    if (tagFilter.length > 0) {
      out = out.filter((quest) =>
        (quest.tags ?? []).some((tag) => tagFilter.includes(tag)),
      );
    }
    return out;
  }, [quests, areaFilter, tagFilter]);

  const subColumns = project.kanbanColumns ?? ["In Progress"];

  const columns: ColumnDescriptor[] = useMemo(() => {
    const cols: ColumnDescriptor[] = [
      {
        key: "column-new",
        kind: "new",
        label: tr("kanban.column.new"),
        dotClass: "bg-blue-500",
      },
    ];
    subColumns.forEach((name, idx) => {
      cols.push({
        key: `column-accepted:${name}`,
        kind: "accepted",
        subColumn: name,
        label: name,
        dotClass: SUB_COLUMN_DOTS[idx % SUB_COLUMN_DOTS.length],
      });
    });
    cols.push({
      key: "column-completed",
      kind: "completed",
      label: tr("kanban.column.completed"),
      dotClass: "bg-green-500",
    });
    return cols;
  }, [subColumns, tr]);

  const grouped = useMemo(() => {
    const byKey: Record<string, QuestResource[]> = {};
    for (const col of columns) byKey[col.key] = [];
    const fallback = columns.find((c) => c.kind === "accepted")?.key;
    for (const quest of filteredQuests) {
      const status = quest.metadata.status;
      if (status === "new") {
        byKey["column-new"].push(quest);
      } else if (status === "completed") {
        byKey["column-completed"].push(quest);
      } else {
        const targetKey = quest.kanbanColumn
          ? `column-accepted:${quest.kanbanColumn}`
          : fallback;
        // If the quest lives in a column that was renamed/deleted, drop it
        // into the first accepted lane rather than losing it on the board.
        const bucketKey = targetKey && byKey[targetKey] ? targetKey : fallback;
        if (bucketKey && byKey[bucketKey]) byKey[bucketKey].push(quest);
      }
    }
    byKey["column-completed"]?.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return byKey;
  }, [filteredQuests, columns]);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await kanbanApi.getBoard({
        params: { projectId: project.id },
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
    const fromStatus = quest.metadata.status as QuestStatus;
    const toKind = columnData.kind as ColumnKind;
    const toSubColumn = columnData.subColumn as string | undefined;

    // No-op if the card was dropped onto its current column.
    if (fromStatus === toKind) {
      if (toKind !== "accepted") return;
      if (quest.kanbanColumn === toSubColumn) return;
    }

    if (fromStatus === "completed") {
      toaster.show(tr("kanban.error.completedCannotMove"), "danger");
      return;
    }

    if (fromStatus === "new" && toKind === "completed") {
      toaster.show(tr("kanban.error.acceptFirst"), "warning");
      return;
    }

    try {
      if (fromStatus === "new" && toKind === "accepted") {
        // Accept the quest then (if needed) move it to the chosen sub-column;
        // acceptQuest drops it in the first column by default.
        await questApi.acceptQuest({ params: { id: quest.id } });
        if (toSubColumn && toSubColumn !== subColumns[0]) {
          await questApi.setQuestKanbanColumn({
            params: { id: quest.id },
            body: { kanbanColumn: toSubColumn },
          });
        }
      } else if (fromStatus === "accepted" && toKind === "new") {
        await questApi.abandonQuest({ params: { id: quest.id } });
      } else if (fromStatus === "accepted" && toKind === "accepted") {
        if (!toSubColumn) return;
        await questApi.setQuestKanbanColumn({
          params: { id: quest.id },
          body: { kanbanColumn: toSubColumn },
        });
      } else if (fromStatus === "accepted" && toKind === "completed") {
        await questApi.completeQuest({
          params: { id: quest.id },
          body: {},
        });
        // Drop the quest from the viewer's assigned list, exactly as
        // QuestView does on the normal completion path.
        alepha.store.set(
          currentAssignedQuestsAtom,
          (alepha.store.get(currentAssignedQuestsAtom) ?? []).filter(
            (q) => q.id !== quest.id,
          ),
        );
      }
      await reload();
    } catch (error: any) {
      toaster.show(error?.message || tr("kanban.error.actionFailed"), "danger");
    }
  };

  return (
    <div
      data-testid="kanban-board"
      className="flex flex-1 flex-col overflow-hidden"
    >
      {/* Filter nav */}
      <div className="flex items-center gap-2 border-border border-b bg-card px-3 py-1.5">
        {loading && (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        )}
        <form {...filterForm.props} className="flex flex-1 items-center gap-2">
          {areaOptions.length > 0 && (
            <div className="w-64 max-w-full">
              <Control
                input={filterForm.input.areas}
                label=""
                clearable
                clearLabel={tr("kanban.filter.allAreas")}
                items={areaOptions}
              />
            </div>
          )}
          {knownTags.length > 0 && (
            <div className="w-64 max-w-full">
              <Control
                input={filterForm.input.tags}
                label=""
                clearable
                clearLabel={tr("kanban.filter.allTags")}
                items={knownTags.map((t) => ({ value: t, label: t }))}
              />
            </div>
          )}
        </form>
      </div>

      {/* Columns */}
      <div className="flex flex-1 overflow-hidden">
        <DndContext id={dndId} sensors={sensors} onDragEnd={handleDragEnd}>
          {columns.map((descriptor, idx) => (
            <KanbanColumn
              key={descriptor.key}
              descriptor={descriptor}
              quests={grouped[descriptor.key] ?? []}
              onSelect={setSelectedQuest}
              last={idx === columns.length - 1}
            />
          ))}
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
          className="w-full p-0 data-[side=right]:sm:max-w-[50vw]"
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
