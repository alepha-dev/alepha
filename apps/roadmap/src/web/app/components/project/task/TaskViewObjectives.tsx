import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ListChecks } from "lucide-react";
import type { TaskController } from "@/api/controllers/TaskController.ts";
import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import { currentAssignedTasksAtom } from "@/web/app/atoms/currentAssignedTasksAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface TaskViewObjectivesProps {
  task: TaskResource;
  onTaskUpdate?: (updatedTask: TaskResource) => void;
}

const TaskViewObjectives = (props: TaskViewObjectivesProps) => {
  const { task, onTaskUpdate } = props;
  const { tr } = useI18n<I18n, "en">();
  const taskApi = useClient<TaskController>();
  const [assignedTasks, setCurrentAssignedTasks] = useStore(
    currentAssignedTasksAtom,
  );

  const handleObjectiveToggle = async (index: number) => {
    try {
      const updatedTask = await taskApi.completeObjective({
        params: { id: task.id },
        body: { index },
      });
      onTaskUpdate?.(updatedTask);
      setCurrentAssignedTasks(
        (assignedTasks ?? []).map((t) =>
          t.id === updatedTask.id ? updatedTask : t,
        ),
      );
    } catch (error) {
      console.error("Failed to update objective:", error);
    }
  };

  if (task.objectives.length === 0) {
    return null;
  }

  const disabled = !!task.completedAt || !task.acceptedAt;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-center gap-2">
        <ListChecks className="size-5" />
        <span className="text-lg font-bold">{tr("task.view.objectives")}</span>
        <div className="bg-border h-px w-full opacity-40" />
      </div>

      <div className="flex flex-col gap-2 px-3 py-2">
        {task.objectives.map((objective, index) => (
          <label key={index} className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={objective.completed}
              onCheckedChange={() => handleObjectiveToggle(index)}
              disabled={disabled}
            />
            <span
              className={
                objective.completed
                  ? "text-sm text-green-600 line-through"
                  : "text-sm"
              }
            >
              {objective.title}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};

export default TaskViewObjectives;
