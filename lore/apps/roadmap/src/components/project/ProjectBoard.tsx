import { DateTimeProvider } from "@alepha/datetime";
import type { Page } from "@alepha/postgres";
import { useClient, useInject, useRouter, useStore } from "@alepha/react";
import {
	ActionIcon,
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
	IconDots,
	IconSearch,
	IconSignature,
	IconTrash,
	IconX,
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
	const [project] = useStore("current_project");
	const taskApi = useClient<TaskApi>();
	const [status, setStatus] = useState<TaskStatus>("new");
	const [result, setResult] = useState<Page<Task> | undefined>();
	const dateFormatter = useInject(DateTimeProvider);
	const [loading, setLoading] = useState(false);
	const router = useRouter<AppRouter>();
	const next = result?.can.next ? result.page.number + 1 : undefined;
	const tasks = result?.content || [];
	const [sortValue, setSortValue] = useState<string | undefined>(undefined);
	const [searchValue, setSearchValue] = useState<string>("");
	const [searchQuery, setSearchQuery] = useState<string>("");

	const loadTasks = async () => {
		if (!project?.id) return;

		setSortValue(undefined);
		setLoading(true);
		try {
			const [result] = await Promise.all([
				await taskApi.getTasks({
					params: { projectId: project.id },
					query: {
						status,
						search: searchQuery || undefined,
					},
				}),
				new Promise((resolve) => setTimeout(resolve, 200)),
			]);
			setResult(result);
		} catch (error) {
			console.error("Error loading tasks:", error);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		loadTasks();
	}, [project?.id, status, searchQuery]);

	const actions = {
		acceptTask: {
			can: () => taskApi.acceptTask.can(),
			onClick: async () => {},
		},
		deleteTask: (id: number) => ({
			can: () => taskApi.deleteTask.can(),
			onClick: async () => {
				await taskApi.deleteTask({
					params: { id },
				});
				await loadTasks();
			},
		}),
		sortBy: (key: string) => ({
			onClick: async () => {
				if (!project?.id) return;

				const sort =
					sortValue === `${key},asc`
						? `${key},desc`
						: sortValue === `${key},desc`
							? undefined
							: `${key},asc`;

				const result = await taskApi.getTasks({
					params: { projectId: project.id },
					query: {
						status,
						page: next,
						sort,
						search: searchQuery || undefined,
					},
				});

				setResult(result);
				setSortValue(sort);
			},
		}),
		more: {
			onClick: async () => {
				if (!project?.id) return;

				const more = await taskApi.getTasks({
					params: { projectId: project.id },
					query: {
						status,
						page: next,
						search: searchQuery || undefined,
					},
				});

				setResult({
					...more,
					content: [...tasks, ...more.content],
				});
			},
		},
	};

	const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		setSearchValue(event.currentTarget.value);
	};

	const handleSearchSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		setSearchQuery(searchValue.trim());
	};

	const handleClearSearch = () => {
		setSearchValue("");
		setSearchQuery("");
	};

	const getPriorityColor = (priority: string) => {
		switch (priority) {
			case "high":
				return "red";
			case "medium":
				return "orange";
			case "low":
				return "gray";
			default:
				return "dark";
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
							<form onSubmit={handleSearchSubmit}>
								<TextInput
									value={searchValue}
									onChange={handleSearchChange}
									placeholder="Search quests..."
									size={"xs"}
									leftSection={<IconSearch size={theme.icon.size.xs} />}
									rightSection={
										searchQuery && (
											<ActionIcon
												size="xs"
												variant="subtle"
												onClick={handleClearSearch}
												color="gray"
											>
												<IconX size={theme.icon.size.xs} />
											</ActionIcon>
										)
									}
								/>
							</form>
							<SegmentedControl
								disabled={loading}
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
							<Text c="dimmed">No {status} quests found</Text>
						</Flex>
					</Card>
				) : (
					<Card flex={1} p={0} className="overflow-auto">
						<Table stickyHeader>
							<Table.Thead>
								<Table.Tr>
									{status === "accepted" && (
										<Table.Th>
											<Action
												h={"auto"}
												p={"xs"}
												{...actions.sortBy("assignedAt")}
											></Action>
										</Table.Th>
									)}
									<Table.Th>
										<Action h={"auto"} p={"xs"} {...actions.sortBy("title")}>
											Quest
										</Action>
									</Table.Th>
									<Table.Th>
										<Action h={"auto"} p={"xs"} {...actions.sortBy("priority")}>
											Priority
										</Action>
									</Table.Th>
									<Table.Th>
										<Action
											h={"auto"}
											p={"xs"}
											{...actions.sortBy("complexity")}
										>
											Rank
										</Action>
									</Table.Th>
									<Table.Th>
										<Action h={"auto"} p={"xs"} {...actions.sortBy("package")}>
											Zone
										</Action>
									</Table.Th>
									<Table.Th>
										<Action
											h={"auto"}
											p={"xs"}
											{...actions.sortBy(
												status === "completed" ? "completedAt" : "createdAt",
											)}
										>
											{status === "completed" ? "Completed" : "Created"}
										</Action>
									</Table.Th>
									<Table.Th></Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{tasks.map((task) => (
									<Table.Tr key={task.id}>
										{status === "accepted" && (
											<Table.Td align={"center"}>
												<img
													alt={"picture"}
													style={{
														height: "24px",
														width: "24px",
														borderRadius: "50%",
													}}
													src={
														"https://api.dicebear.com/9.x/pixel-art/svg?seed=Vivian"
													}
												/>
											</Table.Td>
										)}
										<Table.Td maw={"254px"}>
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
												<Flex
													direction={"column"}
													align={"start"}
													flex={1}
													style={{
														overflow: "hidden",
														whiteSpace: "nowrap",
													}}
												>
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
														<Text
															style={{ textOverflow: "ellipsis" }}
															size="xs"
															c="dimmed"
														>
															{task.description
																.slice(0, 100)
																.replaceAll("<p>", "")
																.replaceAll("</p>", " ")}
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
															color="blue"
															leftSection={
																<IconSignature size={theme.icon.size.xs} />
															}
														>
															Accept Quest
														</Menu.Item>
													)}
													{!task.acceptedAt && <Menu.Divider />}
													<Menu.Item
														color="red"
														{...actions.deleteTask(task.id)}
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
						{next && (
							<Flex p={"md"} justify={"center"} align={"center"}>
								<Action variant="subtle" size="xs" {...actions.more}>
									Load More
								</Action>
							</Flex>
						)}
					</Card>
				)}
			</Card>
		</Stack>
	);
};

export default ProjectBoard;
