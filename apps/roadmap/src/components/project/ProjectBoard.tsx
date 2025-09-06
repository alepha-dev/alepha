import { DateTimeProvider } from "@alepha/datetime";
import { useClient, useInject, useRouter, useStore } from "@alepha/react";
import {
	Badge,
	Card,
	Flex,
	Loader,
	Menu,
	SegmentedControl,
	Stack,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import {
	IconCheck,
	IconDots,
	IconLayoutBoard,
	IconSearch,
	IconSortAZ,
	IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import type { Task } from "../../api/providers/Db.ts";
import type { TaskApi } from "../../api/TaskApi.ts";
import { theme } from "../../constants/theme.ts";
import Action from "../ui/Action.tsx";
import TaskComplexity from "./task/TaskComplexity.tsx";

type TaskStatus = "new" | "accepted" | "completed";

const ProjectBoard = () => {
	const [project] = useStore("project");
	const client = useClient<TaskApi>();
	const [status, setStatus] = useState<TaskStatus>("new");
	const [tasks, setTasks] = useState<Task[]>([]);
	const dateFormatter = useInject(DateTimeProvider);
	const [loading, setLoading] = useState(false);

	const loadTasks = async () => {
		if (!project?.id) return;

		setLoading(true);
		try {
			const [result] = await Promise.all([
				await client.getTasksByStatus({
					params: { projectId: project.id },
					query: { status },
				}),
				new Promise((resolve) => setTimeout(resolve, 500)),
			]);
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
						<Flex
							visibleFrom={"sm"}
							gap={"xs"}
							justify={"center"}
							align={"center"}
						>
							<Text fw={400} size="lg"></Text>
						</Flex>
						<Flex gap={"sm"} align={"center"}>
							<TextInput
								disabled
								placeholder="Search quests..."
								size={"xs"}
								leftSection={<IconSearch size={theme.icon.size.xs} />}
							/>
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
					</Flex>
				</Card>

				{loading ? (
					<Flex flex={1} align={"center"} justify={"center"}>
						<Loader type={"dots"} />
					</Flex>
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
									<Table.Th>
										<Action h={"auto"} p={"xs"}>
											Quest
										</Action>
									</Table.Th>
									<Table.Th>
										<Action h={"auto"} p={"xs"}>
											Priority
										</Action>
									</Table.Th>
									<Table.Th>
										<Action h={"auto"} p={"xs"}>
											Rank
										</Action>
									</Table.Th>
									<Table.Th>
										<Action h={"auto"} p={"xs"}>
											Zone
										</Action>
									</Table.Th>
									<Table.Th>
										<Action h={"auto"} p={"xs"}>
											{status === "completed" ? "Completed" : "Created"}
										</Action>
									</Table.Th>
									<Table.Th></Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{tasks.map((task) => (
									<Table.Tr key={task.id}>
										<Table.Td>
											<Action
												w={"100%"}
												px={"xs"}
												justify={"start"}
												href={router.path("projectTask", {
													params: {
														taskId: task.id,
													},
												})}
												routerGoOptions={{
													meta: { transition: "fadeInUp" },
												}}
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
																.slice(0, 80)}
															{task.description.length > 80 ? "..." : ""}
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
										<Table.Td align={"center"}>
											<TaskComplexity complexity={task.complexity} />
										</Table.Td>
										<Table.Td>
											<Text size="xs">{task.package}</Text>
										</Table.Td>
										<Table.Td>
											<Text size="xs" c="dimmed">
												{dateFormatter
													.of(task.completedAt ?? task.createdAt)
													.fromNow()}
											</Text>
										</Table.Td>
										<Table.Td>
											<Menu
												position="right"
												withArrow
												trigger={"click"}
												arrowSize={12}
												transitionProps={{
													transition: "fade-right",
													duration: 200,
												}}
											>
												<Menu.Target>
													<Action px={"xs"} variant="subtle" size="xs">
														<IconDots size={theme.icon.size.sm} />
													</Action>
												</Menu.Target>
												<Menu.Dropdown>
													{!task.acceptedAt && (
														<Menu.Item
															variant={"light"}
															color="green"
															leftSection={
																<IconCheck size={theme.icon.size.xs} />
															}
														>
															Take Quest
														</Menu.Item>
													)}
													{!task.acceptedAt && <Menu.Divider />}
													<Menu.Item
														color="red"
														leftSection={
															<IconTrash size={theme.icon.size.xs} />
														}
													>
														Delete Quest
													</Menu.Item>
												</Menu.Dropdown>
											</Menu>
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
