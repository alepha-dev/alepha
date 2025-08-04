import type { Task } from "../providers/Db.ts";
import TaskItem from "./TaskItem.tsx";

interface TaskListProps {
	tasks: Task[];
}

const TaskList = (props: TaskListProps) => {
	return props.tasks.map((task) => <TaskItem task={task} key={task.id} />);
};

export default TaskList;
