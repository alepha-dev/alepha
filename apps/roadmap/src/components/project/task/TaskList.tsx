import { useAlepha, useClient } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Flex, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import type { TaskApi } from "../../../api/TaskApi.ts";
import type { Task } from "../../../providers/Db.ts";
import type { I18n } from "../../../services/I18n.ts";
import TaskGroup from "./TaskGroup.jsx";

interface TaskListProps {
  tasks: Task[];
}

const TaskList = (props: TaskListProps) => {
  const { tr } = useI18n<I18n, "en">();
  const taskApi = useClient<TaskApi>();
  const alepha = useAlepha();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const groupByPackage = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const task of props.tasks) {
      grouped[task.package] ??= [];
      grouped[task.package].push(task);
    }
    return grouped;
  }, [props.tasks]);

  const packageList = useMemo(() => {
    return Object.keys(groupByPackage).sort();
  }, [groupByPackage]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

    const taskData = active.data.current;
    const zoneData = over.data.current;

    if (taskData?.type === "task" && zoneData?.type === "zone") {
      const task = taskData.task as Task;
      const newZoneName = zoneData.zoneName as string;

      // Don't update if already in the same zone
      if (task.package === newZoneName) {
        return;
      }

      try {
        const updatedTask = await taskApi.moveTaskToZone({
          params: { id: task.id },
          body: { newZone: newZoneName },
        });

        // Update local state
        const currentTasks = alepha.state.get("current_assigned_tasks") || [];
        const updatedTasks = currentTasks.map((t) =>
          t.id === updatedTask.id ? updatedTask : t,
        );
        alepha.state.set("current_assigned_tasks", updatedTasks);

        // Update project packages if needed
        const currentProject = alepha.state.get("current_project");
        if (currentProject && !currentProject.packages.includes(newZoneName)) {
          alepha.state.set("current_project", {
            ...currentProject,
            packages: [...currentProject.packages, newZoneName],
          });
        }
      } catch (error) {
        console.error("Failed to move task:", error);
      }
    }
  };

  if (packageList.length === 0) {
    return (
      <Flex
        p={"sm"}
        direction={"column"}
        align="center"
        justify="center"
        flex={1}
      >
        <Text c={"dimmed"}>{tr("quest-log.empty")}</Text>
      </Flex>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <Stack gap={0}>
        {packageList.map((key) => (
          <TaskGroup name={key} tasks={groupByPackage[key]} key={key} />
        ))}
      </Stack>
    </DndContext>
  );
};

export default TaskList;
