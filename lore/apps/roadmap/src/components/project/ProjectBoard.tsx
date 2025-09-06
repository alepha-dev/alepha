import { useClient, useRouter, useStore } from "@alepha/react";
import { useI18n } from "@alepha/react-i18n";
import {
	Badge,
	Card,
	Flex,
	SegmentedControl,
	Stack,
	Table,
	Text,
} from "@mantine/core";
import { useEffect, useState } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import type { Task } from "../../api/providers/Db.ts";
import type { TaskApi } from "../../api/TaskApi.ts";
import type { I18n } from "../../services/I18n.ts";
import Action from "../ui/Action.tsx";

type TaskStatus = "new" | "accepted" | "completed";

const ProjectBoard = () => {
	const [project] = useStore("project");
	const client = useClient<TaskApi>();
	const { tr } = useI18n<I18n, "en">();
	const [status, setStatus] = useState<TaskStatus>("new");
	const [tasks, setTasks] = useState<Task[]>([]);
	const [loading, setLoading] = useState(false);

	const loadTasks = async () => {
		if (!project?.id) return;

		setLoading(true);
		try {
			const result = await client.getTasksByStatus({
				params: { projectId: project.id },
				query: { status },
			});
			setTasks(result);
		} catch (error) {
			console.error("Error loading tasks:", error);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadTasks();
	}, [project?.id, status]);

	const router = useRouter<AppRouter>();

	const getPriorityColor = (priority: string) => {
		switch (priority) {
			case "high":
				return "red";
			case "medium":
				return "orange";
			case "low":
				return "yellow";
			default:
				return "gray";
		}
	};

	return (
		<Stack flex={1} gap="md" className="overflow-auto">
			<Card withBorder p={0} flex={1}>
				<Card
					p={0}
					withBorder
					radius={0}
					style={{
						borderRight: 0,
						borderLeft: 0,
						borderTop: 0,
					}}
				>
					<Flex justify="space-between" align="center" p={"sm"}>
						<Text fw={500} size="lg">
							Task Board
						</Text>
						<SegmentedControl
							size={"xs"}
							value={status}
							onChange={(value) => setStatus(value as TaskStatus)}
							data={[
								{ label: "New", value: "new" },
								{ label: "Accepted", value: "accepted" },
								{ label: "Completed", value: "completed" },
							]}
						/>
					</Flex>
				</Card>

				{loading ? (
					<Text c="dimmed"></Text>
				) : tasks.length === 0 ? (
					<Card w={"100%"} p={"md"} c="dimmed" flex={1}>
						<Flex flex={1} align={"center"} justify={"center"}>
							<Text c="dimmed">No {status} tasks found</Text>
						</Flex>
					</Card>
				) : (
					<Card p={0} className="overflow-auto">
						<Table stickyHeader>
							<Table.Thead>
								<Table.Tr>
									<Table.Th>Task</Table.Th>
									<Table.Th>Priority</Table.Th>
									<Table.Th>Difficulty</Table.Th>
									<Table.Th>Zone</Table.Th>
									<Table.Th>
										{status === "completed" ? "Completed" : "Created"}
									</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{tasks.map((task) => (
									<Table.Tr key={task.id}>
										<Table.Td>
											<Action
												href={router.path("projectTask", {
													params: {
														taskId: task.id,
													},
												})}
												flex={1}
											>
												<Flex direction={"column"} align={"start"} flex={1}>
													<Text
														td={task.completedAt ? "line-through" : undefined}
														c={task.completedAt ? "dimmed" : undefined}
														fw={500}
														size="sm"
														lineClamp={1}
													>
														{task.title}
													</Text>
													{task.description && (
														<Text size="xs" c="dimmed" lineClamp={2}>
															{task.description
																.replace(/<[^>]*>/g, "")
																.slice(0, 50)}
														</Text>
													)}
												</Flex>
											</Action>
										</Table.Td>
										<Table.Td>
											<Badge
												size="sm"
												color={getPriorityColor(task.priority)}
												variant="light"
											>
												{task.priority}
											</Badge>
										</Table.Td>
										<Table.Td>
											<Text size="sm">{task.complexity}/5</Text>
										</Table.Td>
										<Table.Td>
											<Text size="xs">{task.package}</Text>
										</Table.Td>
										<Table.Td>
											<Text size="xs" c="dimmed">
												{new Date(
													status === "completed"
														? task.completedAt!
														: task.createdAt,
												).toLocaleDateString()}
											</Text>
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					</Card>
				)}
			</Card>
		</Stack>
	);
};

export default ProjectBoard;
