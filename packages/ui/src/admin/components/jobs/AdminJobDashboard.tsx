import { ActionButton, Flex, StatCards, Text, useToast } from "@alepha/ui";
import { AreaChart, BarChart, DonutChart } from "@mantine/charts";
import { Paper, SegmentedControl, SimpleGrid, Table } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
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

const TIME_RANGES = [
  { label: "24h", value: "1" },
  { label: "7d", value: "7" },
  { label: "14d", value: "14" },
  { label: "30d", value: "30" },
];

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

  const [days, setDays] = useState("7");
  const [stats, setStats] = useState<JobStats | null>(null);
  const [recent, setRecent] = useState<RecentExecution[]>([]);
  const [failures, setFailures] = useState<JobFailure[]>([]);
  const [activity, setActivity] = useState<JobActivityPoint[]>([]);
  const [queueDepth, setQueueDepth] = useState<JobQueueDepth[]>([]);

  const daysNum = Number(days);

  const loadData = useCallback(async () => {
    try {
      const [statsData, recentData, failureData, activityData, queueData] =
        await Promise.all([
          client.getJobStats({ query: { days: daysNum } }),
          client.findJobExecutions({ query: { sort: "-createdAt", size: 10 } }),
          client.getJobTopFailures({ query: { days: daysNum } }),
          client.getJobActivity({ query: { days: daysNum } }),
          client.getJobQueueDepth(),
        ]);
      setStats(statsData);
      setRecent(recentData.content as RecentExecution[]);
      setFailures(failureData);
      setActivity(activityData);
      setQueueDepth(queueData);
    } catch {
      toast.danger("Failed to load dashboard data");
    }
  }, [client, toast, daysNum]);

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

  const rangeLabel =
    TIME_RANGES.find((r) => r.value === days)?.label ?? `${days}d`;

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      <Flex justify="space-between" align="center">
        <Text size="lg" fw={600}>
          Jobs Dashboard
        </Text>
        <Flex
          gap="sm"
          align="center"
          py="xs"
          px="sm"
          style={{
            backgroundColor: "var(--mantine-color-body)",
            borderRadius: "var(--mantine-radius-md)",
            border: "1px solid var(--mantine-color-default-border)",
          }}
        >
          <SegmentedControl
            size="xs"
            data={TIME_RANGES}
            value={days}
            onChange={setDays}
          />
          <ActionButton
            tooltip="Refresh"
            variant="minimal"
            size="sm"
            icon={IconRefresh}
            onClick={loadData}
          />
        </Flex>
      </Flex>

      {/* Stats Cards */}
      {stats && (
        <StatCards
          items={[
            {
              label: "Registered",
              value: stats.registered,
              icon: IconTerminal2,
            },
            {
              label: "Running",
              value: stats.running,
              icon: IconPlayerPlay,
            },
            {
              label: `Completed (${rangeLabel})`,
              value: stats.completed,
              icon: IconCircleCheck,
            },
            {
              label: `Failed (${rangeLabel})`,
              value: stats.failed,
              icon: IconAlertTriangle,
            },
          ]}
        />
      )}

      {/* Charts Row */}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        {/* Activity Timeline */}
        <Paper p="md" radius="md" withBorder>
          <Text size="sm" fw={600} mb="sm">
            Activity ({rangeLabel})
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
                    <Text size="xs" ff="monospace">
                      {exec.status}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {exec.startedAt &&
                      (exec.completedAt || exec.status === "running")
                        ? formatDuration(exec.startedAt, exec.completedAt)
                        : "\u2014"}
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

        {/* Top Failures */}
        <Paper p="md" radius="md" withBorder>
          <Text size="sm" fw={600} mb="sm">
            Top Failures ({rangeLabel})
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
                      <Text size="xs" fw={600} ff="monospace">
                        {f.failures}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text
                        size="xs"
                        c="dimmed"
                        lineClamp={1}
                        style={{ maxWidth: 200 }}
                      >
                        {f.lastError ?? "\u2014"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Flex h={100} align="center" justify="center">
              <Text size="sm" c="dimmed">
                No failures in the last {rangeLabel}
              </Text>
            </Flex>
          )}
        </Paper>
      </SimpleGrid>
    </Flex>
  );
};

export default AdminJobDashboard;
