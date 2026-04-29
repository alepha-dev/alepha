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
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { Project } from "@/api/entities/projects.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import {
  kanbanProjectAtom,
  kanbanReloadAtom,
} from "../../atoms/kanbanProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { Toaster } from "../../services/Toaster.ts";
import TaskView from "../project/task/TaskView.tsx";
import KanbanColumn from "./KanbanColumn.tsx";

type TaskStatus = "new" | "accepted" | "completed";

export interface KanbanBoardProps {
  project: Project;
  tasks: TaskResource[];
  readOnly: boolean;
}

const KanbanBoard = (props: KanbanBoardProps) => {
  const { project, tasks: initialTasks, readOnly } = props;
  const [tasks, setTasks] = useState<TaskResource[]>(initialTasks);
  const [zoneFilter, setZoneFilter] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskResource | null>(null);
  const [, setKanbanProject] = useStore(kanbanProjectAtom);
  const [reloadKey] = useStore(kanbanReloadAtom);
  const taskApi = useClient<TaskController>();
  const kanbanApi = useClient<KanbanController>();
  const { tr } = useI18n<I18n, "en">();
  const toaster = useInject(Toaster);
  const dndId = useId();

  useEffect(() => {
    setKanbanProject({ project, readOnly });
    return () => setKanbanProject(undefined as any);
  }, [project, readOnly]);

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

  const filteredTasks = useMemo(() => {
    if (zoneFilter.length > 0) {
      return tasks.filter((task) => zoneFilter.includes(task.package));
    }
    return tasks;
  }, [tasks, zoneFilter]);

  const grouped = useMemo(() => {
    const result: Record<TaskStatus, TaskResource[]> = {
      new: [],
      accepted: [],
      completed: [],
    };
    for (const task of filteredTasks) {
      result[task.metadata.status].push(task);
    }
    result.completed.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return result;
  }, [filteredTasks]);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await kanbanApi.getBoard({
        params: { projectId: project.id },
      });
      setTasks(data.tasks);
    } finally {
      setLoading(false);
    }
  };

  const closeDrawer = () => {
    setSelectedTask(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const taskData = active.data.current;
    const columnData = over.data.current;
    if (taskData?.type !== "task" || columnData?.type !== "column") return;

    const task = taskData.task as TaskResource;
    const fromStatus = task.metadata.status;
    const toStatus = columnData.status as TaskStatus;

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
        await taskApi.acceptTask({ params: { id: task.id } });
      } else if (fromStatus === "accepted" && toStatus === "new") {
        await taskApi.abandonTask({ params: { id: task.id } });
      } else if (fromStatus === "accepted" && toStatus === "completed") {
        await taskApi.completeTask({ params: { id: task.id } });
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
          {project.packages.map((zone) => {
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
            tasks={grouped.new}
            readOnly={readOnly}
            onSelect={setSelectedTask}
          />
          <KanbanColumn
            status="accepted"
            tasks={grouped.accepted}
            readOnly={readOnly}
            onSelect={setSelectedTask}
          />
          <KanbanColumn
            status="completed"
            tasks={grouped.completed}
            readOnly={readOnly}
            onSelect={setSelectedTask}
            last
          />
        </DndContext>
      </div>

      {/* Task detail sheet */}
      <Sheet
        open={!!selectedTask}
        onOpenChange={(open) => !open && closeDrawer()}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full p-0 sm:max-w-2xl"
        >
          {selectedTask && (
            <TaskView
              task={selectedTask}
              onClose={closeDrawer}
              onTaskChange={(updated) => {
                setSelectedTask(updated);
                setTasks((prev) =>
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
