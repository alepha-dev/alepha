import type { TaskResource } from "@/api/schemas/taskResourceSchema.ts";
import TaskHistoryTimeline from "./TaskHistoryTimeline.tsx";

export interface TaskHistoryProps {
  task: TaskResource;
}

const TaskHistory = (props: TaskHistoryProps) => {
  return (
    <div className="flex flex-1 flex-col py-3">
      {props.task ? <TaskHistoryTimeline task={props.task} /> : null}
    </div>
  );
};

export default TaskHistory;
