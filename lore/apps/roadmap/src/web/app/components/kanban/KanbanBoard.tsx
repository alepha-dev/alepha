import { Control, Flex, useToast } from "@alepha/ui";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Badge, Drawer, Loader } from "@mantine/core";
import { t } from "alepha";
import { useClient, useStore } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
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
import TaskView from "../project/task/TaskView.tsx";
import KanbanColumn from "./KanbanColumn.tsx";

type TaskStatus = "new" | "accepted" | "completed";

interface KanbanBoardProps {
  project: Project;
  tasks: TaskResource[];
  readOnly: boolean;
}

const KanbanBoard = (props: KanbanBoardProps) => {
  const { project, tasks: initialTasks, readOnly } = props;
  const [tasks, setTasks] = useState<TaskResource[]>(initialTasks);
  const [activeZones, setActiveZones] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskResource | null>(null);
  const [, setKanbanProject] = useStore(kanbanProjectAtom);
  const [reloadKey] = useStore(kanbanReloadAtom);
  const taskApi = useClient<TaskController>();
  const kanbanApi = useClient<KanbanController>();
  const { tr } = useI18n<I18n, "en">();
  const toast = useToast();
  const dndId = useId();

  const zonesLoader = useCallback(async () => {
    return project.packages;
  }, [project.packages]);

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

  const filterForm = useForm({
    schema: t.object({
      zones: t.optional(t.array(t.string())),
    }),
    handler: async (values) => {
      setActiveZones(values.zones ?? []);
    },
    onChange: async () => {
      await filterForm.submit();
    },
  });

  const filteredTasks = useMemo(() => {
    if (activeZones.length > 0) {
      return tasks.filter((task) => activeZones.includes(task.package));
    }
    return tasks;
  }, [tasks, activeZones]);

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
      toast.danger({ message: String(tr("kanban.error.completedCannotMove")) });
      return;
    }

    if (fromStatus === "new" && toStatus === "completed") {
      toast.warning({ message: String(tr("kanban.error.acceptFirst")) });
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
      toast.danger({
        message: error?.message || String(tr("kanban.error.actionFailed")),
      });
    }
  };

  return (
    <Flex direction="column" flex={1} style={{ overflow: "hidden" }}>
      {/* Filter nav */}
      <Flex surface borderedBottom centerY gap="xs" px="sm" py={6}>
        {readOnly && (
          <Badge size="xs" variant="light" color="gray">
            {tr("kanban.readOnly")}
          </Badge>
        )}
        {loading && <Loader type="dots" size="xs" />}
        <Flex flex={1} gap="xs">
          <Control
            size={"xs"}
            input={filterForm.input.zones}
            select={{
              label: "",
              multiSelectProps: {
                placeholder: "Zones",
              },
              loader: zonesLoader,
            }}
          />
        </Flex>
      </Flex>

      {/* Columns */}
      <Flex flex={1} style={{ overflow: "hidden" }}>
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
      </Flex>

      {/* Task detail drawer */}
      <Drawer
        position="right"
        size="xl"
        opened={!!selectedTask}
        onClose={closeDrawer}
        withCloseButton={false}
        padding={0}
        className="drawer"
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
      </Drawer>
    </Flex>
  );
};

export default KanbanBoard;
