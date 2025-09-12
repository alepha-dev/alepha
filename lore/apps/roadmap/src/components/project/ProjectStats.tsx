import { AreaChart, BarChart, DonutChart } from "@mantine/charts";
import {
	Badge,
	Card,
	Flex,
	Grid,
	Group,
	SimpleGrid,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import {
	IconChartBar,
	IconCrown,
	IconStar,
	IconTarget,
	IconTrendingUp,
	IconTrophy,
	IconUsers,
} from "@tabler/icons-react";

export interface ProjectStatsProps {
	stats: {
		overview: {
			totalTasks: number;
			completedTasks: number;
			activePlayers: number;
			totalXP: number;
			averageTaskComplexity: number;
		};
		tasksByPriority: Array<{
			priority: string;
			count: number;
			completed: number;
		}>;
		tasksByComplexity: Array<{
			complexity: number;
			count: number;
			averageXP: number;
		}>;
		playerProgress: Array<{
			playerName: string;
			level: number;
			xp: number;
			tasksCompleted: number;
			isOwner: boolean;
		}>;
		activityTimeline: Array<{
			date: string;
			tasksCompleted: number;
			xpGained: number;
		}>;
		completionRate: {
			weekly: number;
			monthly: number;
			overall: number;
		};
	};
}

const ProjectStats = (props: ProjectStatsProps) => {
	const { stats } = props;

	// Prepare data for charts
	const priorityData = stats.tasksByPriority.map((item) => ({
		priority: item.priority.charAt(0).toUpperCase() + item.priority.slice(1),
		total: item.count,
		completed: item.completed,
		remaining: item.count - item.completed,
	}));

	const complexityData = stats.tasksByComplexity.map((item) => ({
		complexity: `Level ${item.complexity}`,
		count: item.count,
		averageXP: item.averageXP,
	}));

	const playerData = stats.playerProgress.slice(0, 8).map((player) => ({
		name:
			player.playerName.length > 12
				? `${player.playerName.substring(0, 12)}...`
				: player.playerName,
		xp: player.xp,
		level: player.level,
		tasks: player.tasksCompleted,
		isOwner: player.isOwner,
	}));

	const timelineData = stats.activityTimeline
		.reverse()
		.slice(-14) // Last 14 days
		.map((item) => ({
			date: new Date(item.date).toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
			}),
			tasks: item.tasksCompleted,
			xp: item.xpGained,
		}));

	const completionDonutData = [
		{
			name: "Completed",
			value: stats.overview.completedTasks,
			color: "green.6",
		},
		{
			name: "Remaining",
			value: stats.overview.totalTasks - stats.overview.completedTasks,
			color: "gray.4",
		},
	];

	return (
		<Flex flex={1} p="lg" className={"overflow-auto"}>
			<Stack w="100%" maw={1200}>
				<Group gap="sm" align="center">
					<IconChartBar size={24} />
					<Title order={2}>Project Analytics</Title>
				</Group>

				<Text c="dimmed" size="sm">
					Comprehensive insights into project progress and team performance
				</Text>

				{/* Overview Cards */}
				<SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
					<Card
						shadow="sm"
						padding="lg"
						radius="md"
						withBorder
						bg={"var(--card-bg-color)"}
					>
						<Group gap="sm">
							<IconTarget size={20} color="var(--mantine-color-blue-6)" />
							<Stack gap={0} flex={1}>
								<Text size="xl" fw={700}>
									{stats.overview.totalTasks}
								</Text>
								<Text size="sm" c="dimmed">
									Total Tasks
								</Text>
							</Stack>
						</Group>
					</Card>

					<Card
						shadow="sm"
						padding="lg"
						radius="md"
						withBorder
						bg={"var(--card-bg-color)"}
					>
						<Group gap="sm">
							<IconTrophy size={20} color="var(--mantine-color-green-6)" />
							<Stack gap={0} flex={1}>
								<Text size="xl" fw={700}>
									{stats.overview.completedTasks}
								</Text>
								<Text size="sm" c="dimmed">
									Completed
								</Text>
							</Stack>
						</Group>
					</Card>

					<Card
						shadow="sm"
						padding="lg"
						radius="md"
						withBorder
						bg={"var(--card-bg-color)"}
					>
						<Group gap="sm">
							<IconUsers size={20} color="var(--mantine-color-purple-6)" />
							<Stack gap={0} flex={1}>
								<Text size="xl" fw={700}>
									{stats.overview.activePlayers}
								</Text>
								<Text size="sm" c="dimmed">
									Active Players
								</Text>
							</Stack>
						</Group>
					</Card>

					<Card
						shadow="sm"
						padding="lg"
						radius="md"
						withBorder
						bg={"var(--card-bg-color)"}
					>
						<Group gap="sm">
							<IconStar size={20} color="var(--mantine-color-yellow-6)" />
							<Stack gap={0} flex={1}>
								<Text size="xl" fw={700}>
									{stats.overview.totalXP.toLocaleString()}
								</Text>
								<Text size="sm" c="dimmed">
									Total XP
								</Text>
							</Stack>
						</Group>
					</Card>
				</SimpleGrid>

				<Grid>
					{/* Completion Progress */}
					<Grid.Col span={{ base: 12, md: 6 }}>
						<Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
							<Stack gap="md">
								<Title order={4}>Task Completion</Title>
								{stats.overview.totalTasks > 0 ? (
									<>
										<DonutChart
											data={completionDonutData}
											thickness={30}
											size={160}
											withLabels
											withTooltip
											tooltipDataSource="segment"
										/>
										<Stack gap="xs">
											<Group justify="space-between">
												<Text size="sm">Overall Progress</Text>
												<Text size="sm" fw={500}>
													{stats.completionRate.overall.toFixed(1)}%
												</Text>
											</Group>
											<Group justify="space-between">
												<Text size="sm">This Week</Text>
												<Text size="sm" fw={500}>
													{stats.completionRate.weekly} tasks
												</Text>
											</Group>
											<Group justify="space-between">
												<Text size="sm">This Month</Text>
												<Text size="sm" fw={500}>
													{stats.completionRate.monthly} tasks
												</Text>
											</Group>
										</Stack>
									</>
								) : (
									<Text c="dimmed" ta="center" py="xl">
										No tasks yet
									</Text>
								)}
							</Stack>
						</Card>
					</Grid.Col>

					{/* Tasks by Priority */}
					<Grid.Col span={{ base: 12, md: 6 }}>
						<Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
							<Stack gap="md">
								<Title order={4}>Tasks by Priority</Title>
								{priorityData.length > 0 ? (
									<BarChart
										h={200}
										data={priorityData}
										dataKey="priority"
										series={[
											{ name: "completed", color: "green.6" },
											{ name: "remaining", color: "gray.4" },
										]}
										tickLine="xy"
										withTooltip
									/>
								) : (
									<Text c="dimmed" ta="center" py="xl">
										No data available
									</Text>
								)}
							</Stack>
						</Card>
					</Grid.Col>

					{/* Activity Timeline */}
					<Grid.Col span={12}>
						<Card shadow="sm" padding="lg" radius="md" withBorder>
							<Stack gap="md">
								<Group gap="sm">
									<IconTrendingUp size={20} />
									<Title order={4}>Activity Timeline (Last 14 Days)</Title>
								</Group>
								{timelineData.length > 0 ? (
									<AreaChart
										h={250}
										data={timelineData}
										dataKey="date"
										series={[
											{
												name: "tasks",
												label: "Tasks Completed",
												color: "blue.6",
											},
											{ name: "xp", label: "XP Gained", color: "green.6" },
										]}
										curveType="monotone"
										withGradient
										withTooltip
										withLegend
									/>
								) : (
									<Text c="dimmed" ta="center" py="xl">
										No recent activity
									</Text>
								)}
							</Stack>
						</Card>
					</Grid.Col>

					{/* Task Complexity Distribution */}
					<Grid.Col span={{ base: 12, md: 6 }}>
						<Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
							<Stack gap="md">
								<Title order={4}>Task Complexity</Title>
								{complexityData.length > 0 ? (
									<BarChart
										h={200}
										data={complexityData}
										dataKey="complexity"
										series={[
											{ name: "count", label: "Task Count", color: "indigo.6" },
										]}
										withTooltip
									/>
								) : (
									<Text c="dimmed" ta="center" py="xl">
										No data available
									</Text>
								)}
							</Stack>
						</Card>
					</Grid.Col>

					{/* Player Progress */}
					<Grid.Col span={{ base: 12, md: 6 }}>
						<Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
							<Stack gap="md">
								<Title order={4}>Player Progress</Title>
								{playerData.length > 0 ? (
									<BarChart
										h={200}
										data={playerData}
										dataKey="name"
										series={[
											{
												name: "xp",
												label: "Experience Points",
												color: "yellow.6",
											},
										]}
										withTooltip
									/>
								) : (
									<Text c="dimmed" ta="center" py="xl">
										No players yet
									</Text>
								)}
							</Stack>
						</Card>
					</Grid.Col>

					{/* Top Performers */}
					<Grid.Col span={12}>
						<Card shadow="sm" padding="lg" radius="md" withBorder>
							<Stack gap="md">
								<Title order={4}>Top Performers</Title>
								{stats.playerProgress.length > 0 ? (
									<SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
										{stats.playerProgress.slice(0, 6).map((player, index) => (
											<Card
												key={player.playerName}
												withBorder
												p="sm"
												bg={"var(--card-bg-color)"}
											>
												<Group gap="sm" align="center">
													<Badge
														variant="light"
														color={
															index === 0
																? "yellow"
																: index === 1
																	? "gray"
																	: "orange"
														}
														size="lg"
													>
														#{index + 1}
													</Badge>
													<Stack gap={0} flex={1}>
														<Group gap="xs">
															<Text size="sm" fw={500}>
																{player.playerName}
															</Text>
															{player.isOwner && (
																<IconCrown
																	size={14}
																	color="var(--mantine-color-yellow-6)"
																/>
															)}
														</Group>
														<Group gap="lg">
															<Text size="xs" c="dimmed">
																Level {player.level}
															</Text>
															<Text size="xs" c="dimmed">
																{player.xp.toLocaleString()} XP
															</Text>
															<Text size="xs" c="dimmed">
																{player.tasksCompleted} tasks
															</Text>
														</Group>
													</Stack>
												</Group>
											</Card>
										))}
									</SimpleGrid>
								) : (
									<Text c="dimmed" ta="center" py="xl">
										No players to display
									</Text>
								)}
							</Stack>
						</Card>
					</Grid.Col>
				</Grid>
			</Stack>
		</Flex>
	);
};

export default ProjectStats;
