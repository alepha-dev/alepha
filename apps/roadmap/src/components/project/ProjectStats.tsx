import { useAlepha, useClient } from "@alepha/react";
import { AreaChart, BarChart } from "@mantine/charts";
import {
  Card,
  Flex,
  Grid,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconChartBar,
  IconDownload,
  IconStar,
  IconTarget,
  IconTrendingUp,
  IconTrophy,
  IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import type { ProjectStatsApi } from "../../api/ProjectStatsApi.ts";
import Action from "../ui/Action.jsx";

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
    topZones: Array<{
      zone: string;
      totalTasks: number;
    }>;
    activityTimeline: Array<{
      date: string;
      tasksCompleted: number;
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
  const alepha = useAlepha();
  const projectStatsApi = useClient<ProjectStatsApi>();
  const currentProject = alepha.state.get("current_project");
  const [timelineRange, setTimelineRange] = useState<string>("14days");

  const handleExportCsv = async () => {
    if (!currentProject) {
      notifications.show({
        title: "Error",
        message: "No project selected",
        color: "red",
      });
      return;
    }

    try {
      const csvData = await projectStatsApi.exportTasksCsv({
        params: { id: currentProject.id },
      });

      // Create blob and download
      const url = window.URL.createObjectURL(
        new Blob([await csvData.text()], { type: "text/csv" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = csvData.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      notifications.show({
        title: "Success",
        message: "Tasks exported to CSV successfully",
        color: "green",
      });
    } catch (error: any) {
      notifications.show({
        title: "Export Failed",
        message: error?.message || "Failed to export tasks",
        color: "red",
      });
    }
  };

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

  const zonesData = stats.topZones.map((zone) => ({
    zone:
      zone.zone.length > 15 ? `${zone.zone.substring(0, 15)}...` : zone.zone,
    fullZone: zone.zone,
    totalTasks: zone.totalTasks,
  }));

  // Filter and aggregate timeline data based on selected range
  const getFilteredTimelineData = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let cutoffDate: Date;
    let aggregateByWeek = false;
    let aggregateByMonth = false;

    switch (timelineRange) {
      case "7days":
        cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 6);
        break;
      case "14days":
        cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 13);
        break;
      case "30days":
        cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 29);
        break;
      case "90days":
        cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 89);
        aggregateByWeek = true;
        break;
      case "1year":
        cutoffDate = new Date(today);
        cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
        aggregateByMonth = true;
        break;
      case "all":
        cutoffDate = new Date(0); // Beginning of time
        aggregateByMonth = true;
        break;
      default:
        cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 13);
    }

    const filteredData = stats.activityTimeline.filter(
      (item) => new Date(item.date) >= cutoffDate,
    );

    // Aggregate by week
    if (aggregateByWeek) {
      const weekMap = new Map<string, number>();

      for (const item of filteredData) {
        const date = new Date(item.date);
        // Get the Monday of the week
        const monday = new Date(date);
        const day = monday.getDay();
        const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
        monday.setDate(diff);
        monday.setHours(0, 0, 0, 0);

        const weekKey = monday.toISOString().split("T")[0];
        weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + item.tasksCompleted);
      }

      return Array.from(weekMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([weekStart, tasks]) => ({
          date: new Date(weekStart).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          }),
          tasks,
        }));
    }

    // Aggregate by month
    if (aggregateByMonth) {
      const monthMap = new Map<string, number>();

      for (const item of filteredData) {
        const date = new Date(item.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        monthMap.set(
          monthKey,
          (monthMap.get(monthKey) || 0) + item.tasksCompleted,
        );
      }

      return Array.from(monthMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([monthKey, tasks]) => {
          const [year, month] = monthKey.split("-");
          const date = new Date(Number(year), Number(month) - 1, 1);
          return {
            date: date.toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            }),
            tasks,
          };
        });
    }

    // Daily data for short ranges
    return filteredData.map((item) => ({
      date: new Date(item.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      tasks: item.tasksCompleted,
    }));
  };

  const timelineData = getFilteredTimelineData();

  return (
    <Flex flex={1} p="lg" className={"overflow-auto"}>
      <Stack w="100%" maw={1200}>
        <Group justify="space-between" align="center">
          <Group gap="sm" align="center">
            <IconChartBar size={24} />
            <Title order={2}>Project Analytics</Title>
          </Group>
          <Action
            variant="light"
            leftSection={<IconDownload size={16} />}
            onClick={handleExportCsv}
            size="sm"
          >
            Export CSV
          </Action>
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
            bg={"var(--alepha-elevated)"}
          >
            <Group gap="sm">
              <IconTarget size={20} opacity={0.6} />
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
            bg={"var(--alepha-elevated)"}
          >
            <Group gap="sm">
              <IconTrophy size={20} opacity={0.6} />
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
            bg={"var(--alepha-elevated)"}
          >
            <Group gap="sm">
              <IconUsers size={20} opacity={0.6} />
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
            bg={"var(--alepha-elevated)"}
          >
            <Group gap="sm">
              <IconStar size={20} opacity={0.6} />
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
          {/* Activity Timeline */}
          <Grid.Col span={12}>
            <Card shadow="sm" padding="lg" radius="md" withBorder>
              <Stack gap="md">
                <Group justify="space-between" align="center">
                  <Group gap="sm">
                    <IconTrendingUp size={20} />
                    <Title order={4}>Activity Timeline</Title>
                  </Group>
                  <Select
                    value={timelineRange}
                    onChange={(value) => setTimelineRange(value || "14days")}
                    data={[
                      { value: "7days", label: "Last 7 Days" },
                      { value: "14days", label: "Last 14 Days" },
                      { value: "30days", label: "Last 30 Days" },
                      { value: "90days", label: "Last 90 Days" },
                      { value: "1year", label: "Last Year" },
                      { value: "all", label: "All Time" },
                    ]}
                    size="xs"
                    w={140}
                  />
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
                    ]}
                    curveType="monotone"
                    withGradient
                    withTooltip
                  />
                ) : (
                  <Text c="dimmed" ta="center" py="xl">
                    No recent activity
                  </Text>
                )}
              </Stack>
            </Card>
          </Grid.Col>

          {/* Top 6 Zones */}
          <Grid.Col span={12}>
            <Card shadow="sm" padding="lg" radius="md" withBorder h="100%">
              <Stack gap="md">
                <Title order={4}>Top 6 Zones</Title>
                {zonesData.length > 0 ? (
                  <BarChart
                    h={200}
                    data={zonesData}
                    dataKey="zone"
                    series={[
                      {
                        name: "totalTasks",
                        label: "Total Tasks",
                        color: "blue.6",
                      },
                    ]}
                    withTooltip
                  />
                ) : (
                  <Text c="dimmed" ta="center" py="xl">
                    No zones yet
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
        </Grid>
      </Stack>
    </Flex>
  );
};

export default ProjectStats;
