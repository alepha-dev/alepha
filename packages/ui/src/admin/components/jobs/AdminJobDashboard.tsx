import { ActionButton, Flex, Text, useToast } from "@alepha/ui";
import { AreaChart, BarChart, DonutChart } from "@mantine/charts";
import { Badge, Paper, SimpleGrid, Table, ThemeIcon } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconPlayerPlay,
  IconRefresh,
  IconTerminal2,
} from "@tabler/icons-react";
import type {
  AdminJobController,
  JobActivityPoint,
  JobFailure,
  JobQueueDepth,
  JobStats,
} from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────

const formatDuration = (
  start: Date | string,
  end?: Date | string | null,
): string => {
  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();
  const duration = endTime - startTime;

  if (duration < 1000) return `${duration}ms`;
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
  if (duration < 3600000)
    return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
  return `${Math.floor(duration / 3600000)}h ${Math.floor((duration % 3600000) / 60000)}m`;
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "completed":
      return "teal";
    case "running":
      return "blue";
    case "failed":
    case "dead":
      return "red";
    case "cancelled":
      return "orange";
    case "scheduled":
      return "violet";
    case "retrying":
      return "yellow";
    case "pending":
      return "gray";
    default:
      return "gray";
  }
};

const getStatusIcon = (status: string, size = 14) => {
  switch (status) {
    case "completed":
      return <IconCircleCheck size={size} />;
    case "failed":
    case "dead":
      return <IconCircleX size={size} />;
    case "running":
      return <IconPlayerPlay size={size} />;
    case "cancelled":
      return <IconAlertTriangle size={size} />;
    default:
      return <IconClock size={size} />;
  }
};

// ─────────────────────────────────────────────────────────────────────────────

interface RecentExecution {
  id: string;
  jobName: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────

const AdminJobDashboard = () => {
  const client = useClient<AdminJobController>();
  const { l } = useI18n();
  const toast = useToast();

  const [stats, setStats] = useState<JobStats | null>(null);
  const [recent, setRecent] = useState<RecentExecution[]>([]);
  const [failures, setFailures] = useState<JobFailure[]>([]);
  const [activity, setActivity] = useState<JobActivityPoint[]>([]);
  const [queueDepth, setQueueDepth] = useState<JobQueueDepth[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [statsData, recentData, failureData, activityData, queueData] =
        await Promise.all([
          client.getJobStats(),
          client.findExecutions({ query: { sort: "-createdAt", size: 10 } }),
          client.getTopFailures(),
          client.getActivity({ query: { days: 14 } }),
          client.getQueueDepth(),
        ]);
      setStats(statsData);
      setRecent(recentData.content as RecentExecution[]);
      setFailures(failureData);
      setActivity(activityData);
      setQueueDepth(queueData);
    } catch {
      toast.danger("Failed to load dashboard data");
    }
  }, [client, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Prepare chart data
  const activityChartData = activity.map((point) => ({
    date: new Date(point.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    completed: point.completed,
    failed: point.failed,
  }));

  const queueChartData = queueDepth
    .filter(
      (q) => q.pending + q.running + q.scheduled + q.retrying + q.dead > 0,
    )
    .map((q) => ({
      job:
        q.jobName.length > 20
          ? `...${q.jobName.slice(q.jobName.length - 18)}`
          : q.jobName,
      pending: q.pending,
      running: q.running,
      scheduled: q.scheduled,
      retrying: q.retrying,
      dead: q.dead,
    }));

  const statusDonutData = stats
    ? [
        { name: "Running", value: stats.running, color: "blue" },
        { name: "Pending", value: stats.pending, color: "gray" },
        { name: "Scheduled", value: stats.scheduled, color: "violet" },
        { name: "Retrying", value: stats.retrying, color: "yellow" },
        { name: "Dead", value: stats.dead, color: "red" },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      <Flex justify="space-between" align="center">
        <Text size="lg" fw={600}>
          Jobs Dashboard
        </Text>
        <ActionButton
          tooltip="Refresh"
          variant="light"
          size="sm"
          icon={IconRefresh}
          onClick={loadData}
        />
      </Flex>

      {/* Stats Cards */}
      {stats && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
          <Paper p="md" radius="md" withBorder>
            <Flex justify="space-between">
              <Flex direction="column">
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Registered
                </Text>
                <Text size="xl" fw={700} ff="monospace">
                  {stats.registered}
                </Text>
              </Flex>
              <ThemeIcon size="lg" radius="md" variant="light" color="blue">
                <IconTerminal2 size={20} />
              </ThemeIcon>
            </Flex>
          </Paper>

          <Paper p="md" radius="md" withBorder>
            <Flex justify="space-between">
              <Flex direction="column">
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Running
                </Text>
                <Text
                  size="xl"
                  fw={700}
                  ff="monospace"
                  c={stats.running > 0 ? "blue" : undefined}
                >
                  {stats.running}
                </Text>
              </Flex>
              <ThemeIcon
                size="lg"
                radius="md"
                variant="light"
                color={stats.running > 0 ? "blue" : "gray"}
              >
                <IconPlayerPlay size={20} />
              </ThemeIcon>
            </Flex>
          </Paper>

          <Paper p="md" radius="md" withBorder>
            <Flex justify="space-between">
              <Flex direction="column">
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Completed 24h
                </Text>
                <Text size="xl" fw={700} ff="monospace" c="teal">
                  {stats.completed24h}
                </Text>
              </Flex>
              <ThemeIcon size="lg" radius="md" variant="light" color="teal">
                <IconCircleCheck size={20} />
              </ThemeIcon>
            </Flex>
          </Paper>

          <Paper p="md" radius="md" withBorder>
            <Flex justify="space-between">
              <Flex direction="column">
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Failed 24h
                </Text>
                <Text
                  size="xl"
                  fw={700}
                  ff="monospace"
                  c={stats.failed24h > 0 ? "red" : undefined}
                >
                  {stats.failed24h}
                </Text>
              </Flex>
              <ThemeIcon
                size="lg"
                radius="md"
                variant="light"
                color={stats.failed24h > 0 ? "red" : "gray"}
              >
                <IconAlertTriangle size={20} />
              </ThemeIcon>
            </Flex>
          </Paper>
        </SimpleGrid>
      )}

      {/* Charts Row */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        {/* Activity Timeline */}
        <Paper p="md" radius="md" withBorder>
          <Text size="sm" fw={600} mb="sm">
            Activity (14d)
          </Text>
          {activityChartData.length > 0 ? (
            <AreaChart
              h={220}
              data={activityChartData}
              dataKey="date"
              series={[
                { name: "completed", label: "Completed", color: "teal.6" },
                { name: "failed", label: "Failed", color: "red.6" },
              ]}
              curveType="monotone"
              withGradient
              withTooltip
              withDots={false}
            />
          ) : (
            <Flex h={220} align="center" justify="center">
              <Text size="sm" c="dimmed">
                No activity data
              </Text>
            </Flex>
          )}
        </Paper>

        {/* Current Status Donut */}
        <Paper p="md" radius="md" withBorder>
          <Text size="sm" fw={600} mb="sm">
            Active Executions
          </Text>
          {statusDonutData.length > 0 ? (
            <DonutChart
              h={220}
              data={statusDonutData}
              withTooltip
              tooltipDataSource="segment"
              chartLabel={String(
                statusDonutData.reduce((sum, d) => sum + d.value, 0),
              )}
            />
          ) : (
            <Flex h={220} align="center" justify="center">
              <Text size="sm" c="dimmed">
                No active executions
              </Text>
            </Flex>
          )}
        </Paper>
      </SimpleGrid>

      {/* Queue Depth Chart */}
      {queueChartData.length > 0 && (
        <Paper p="md" radius="md" withBorder>
          <Text size="sm" fw={600} mb="sm">
            Queue Depth by Job
          </Text>
          <BarChart
            h={200}
            data={queueChartData}
            dataKey="job"
            type="stacked"
            series={[
              { name: "running", label: "Running", color: "blue.6" },
              { name: "pending", label: "Pending", color: "gray.5" },
              { name: "scheduled", label: "Scheduled", color: "violet.5" },
              { name: "retrying", label: "Retrying", color: "yellow.5" },
              { name: "dead", label: "Dead", color: "red.6" },
            ]}
            withTooltip
            withLegend
          />
        </Paper>
      )}

      {/* Recent Activity + Top Failures side by side */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        {/* Recent Activity */}
        <Paper p="md" radius="md" withBorder>
          <Text size="sm" fw={600} mb="sm">
            Recent Executions
          </Text>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Job</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Duration</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recent.map((exec) => (
                <Table.Tr key={exec.id}>
                  <Table.Td>
                    <Text size="xs" fw={500} ff="monospace" lineClamp={1}>
                      {exec.jobName}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      size="xs"
                      variant="light"
                      color={getStatusColor(exec.status)}
                      leftSection={getStatusIcon(exec.status, 10)}
                    >
                      {exec.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {exec.startedAt &&
                      (exec.completedAt || exec.status === "running")
                        ? formatDuration(exec.startedAt, exec.completedAt)
                        : "—"}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
              {recent.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={3}>
                    <Text size="sm" c="dimmed" ta="center">
                      No recent executions
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Paper>

        {/* Top Failures (7d) */}
        <Paper p="md" radius="md" withBorder>
          <Text size="sm" fw={600} mb="sm">
            Top Failures (7d)
          </Text>
          {failures.length > 0 ? (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Job</Table.Th>
                  <Table.Th>Count</Table.Th>
                  <Table.Th>Last Error</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {failures.map((f) => (
                  <Table.Tr key={f.jobName}>
                    <Table.Td>
                      <Text size="xs" fw={500} ff="monospace" lineClamp={1}>
                        {f.jobName}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color="red">
                        {f.failures}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text
                        size="xs"
                        c="dimmed"
                        lineClamp={1}
                        style={{ maxWidth: 200 }}
                      >
                        {f.lastError ?? "—"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Flex h={100} align="center" justify="center">
              <Text size="sm" c="dimmed">
                No failures in the last 7 days
              </Text>
            </Flex>
          )}
        </Paper>
      </SimpleGrid>
    </Flex>
  );
};

export default AdminJobDashboard;
