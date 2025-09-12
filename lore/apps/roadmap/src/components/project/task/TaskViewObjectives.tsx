import { useClient, useStore } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import { Checkbox, Flex, Stack, Text } from "@mantine/core";
import { IconListCheck } from "@tabler/icons-react";
import type { Task } from "../../../api/providers/Db.ts";
import type { TaskApi } from "../../../api/TaskApi.ts";
import { theme } from "../../../constants/theme.ts";
import type { I18n } from "../../../services/I18n.ts";

interface TaskViewObjectivesProps {
	task: Task;
	onTaskUpdate?: (updatedTask: Task) => void;
}

const TaskViewObjectives = ({
	task,
	onTaskUpdate,
}: TaskViewObjectivesProps) => {
	const { tr } = useI18n<I18n, "en">();
	const taskApi = useClient<TaskApi>();
	const [assignedTasks, setCurrentAssignedTasks] = useStore(
		"current_assigned_tasks",
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

	return (
		<>
			<Flex gap={"xs"} align="center" justify="center">
				<IconListCheck size={theme.icon.size.lg} />
				<Text size="lg" fw={"bold"}>
					{tr("task.view.objectives", { default: "Objectives" })}
				</Text>
				<Flex
					w={"100%"}
					style={{
						opacity: 0.1,
						height: 1,
						backgroundColor: "var(--text-color)",
					}}
				/>
			</Flex>

			{task.objectives.length > 0 ? (
				<Stack py={"xs"} px={"sm"}>
					{task.objectives.map((objective, index) => (
						<Checkbox
							style={{
								cursor: "pointer",
							}}
							key={index}
							checked={objective.completed}
							onChange={() => handleObjectiveToggle(index)}
							disabled={!!task.completedAt || !task.acceptedAt}
							label={
								<Text
									size={"sm"}
									style={{
										textDecoration: objective.completed
											? "line-through"
											: "none",
										color: objective.completed
											? "var(--color-green)"
											: "var(--text-color)",
									}}
								>
									{objective.title}
								</Text>
							}
						/>
					))}
				</Stack>
			) : (
				<Text size={"sm"}>
					{tr("task.view.noObjectives", {
						default: "No objectives defined.",
					})}
				</Text>
			)}
		</>
	);
};

export default TaskViewObjectives;
