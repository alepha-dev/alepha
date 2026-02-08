import {
  ActionButton,
  DataTable,
  Flex,
  Text,
  useDialog,
  useToast,
} from "@alepha/ui";
import {
  ActionIcon,
  Badge,
  Card,
  Paper,
  Progress,
  RingProgress,
  ScrollArea,
  SimpleGrid,
  Skeleton,
  Tabs,
  ThemeIcon,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconPlayerPlay,
  IconRefresh,
  IconTerminal2,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import {
  type AdminJobController,
  type JobExecutionEntity,
  jobExecutions,
} from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface JobStats {
  name: string;
  total: number;
  completed: number;
  failed: number;
  running: number;
  avgDuration: number;
  lastRun?: Date;
  lastStatus?: "COMPLETED" | "FAILED" | "STARTED";
}

interface LogEntry {
  level: string;
  message: string;
  service: string;
  module: string;
  timestamp: number;
  data?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
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
    case "COMPLETED":
      return "teal";
    case "FAILED":
      return "red";
    case "STARTED":
      return "blue";
    default:
      return "gray";
  }
};

const getStatusIcon = (status: string, size = 14) => {
  switch (status) {
    case "COMPLETED":
      return <IconCircleCheck size={size} />;
    case "FAILED":
      return <IconCircleX size={size} />;
    case "STARTED":
      return <IconPlayerPlay size={size} />;
    default:
      return <IconClock size={size} />;
  }
};

const getLogLevelColor = (level: string) => {
  switch (level) {
    case "ERROR":
      return "red";
    case "WARN":
      return "yellow";
    case "INFO":
      return "blue";
    case "DEBUG":
      return "gray";
    case "TRACE":
      return "dimmed";
    default:
      return "dimmed";
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Job Card Component
// ─────────────────────────────────────────────────────────────────────────────

interface JobCardProps {
  job: string;
  stats?: JobStats;
  isTriggering: boolean;
  onTrigger: (job: string) => void;
  onSelect: (job: string) => void;
  isSelected: boolean;
}

const JobCard = (props: JobCardProps) => {
  const { job, stats, isTriggering, onTrigger, onSelect, isSelected } = props;
  const theme = useMantineTheme();

  const successRate = stats
    ? stats.total > 0
      ? (stats.completed / stats.total) * 100
      : 0
    : 0;

  return (
    <Card
      p="md"
      radius="md"
      withBorder
      onClick={() => onSelect(job)}
      style={{
        cursor: "pointer",
        borderColor: isSelected ? theme.colors.blue[6] : undefined,
        backgroundColor: isSelected
          ? "var(--mantine-color-blue-light)"
          : undefined,
        transition: "all 150ms ease",
      }}
    >
      <Flex justify="space-between" mb="xs">
        <Flex gap="xs">
          <ThemeIcon
            size="sm"
            radius="sm"
            variant="light"
            color={
              stats?.lastStatus ? getStatusColor(stats.lastStatus) : "gray"
            }
          >
            <IconTerminal2 size={14} />
          </ThemeIcon>
          <Text size="sm" fw={600} ff="monospace">
            {job}
          </Text>
        </Flex>
        <Tooltip label="Trigger job manually" position="left">
          <ActionIcon
            size="sm"
            variant="light"
            color="blue"
            loading={isTriggering}
            onClick={(e) => {
              e.stopPropagation();
              onTrigger(job);
            }}
          >
            <IconPlayerPlay size={12} />
          </ActionIcon>
        </Tooltip>
      </Flex>

      {stats ? (
        <>
          <Flex gap="lg" mb="xs">
            <Flex>
              <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
                Total
              </Text>
              <Text size="lg" fw={700} ff="monospace">
                {stats.total}
              </Text>
            </Flex>
            <Flex>
              <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
                Success
              </Text>
              <Text size="lg" fw={700} ff="monospace" c="teal">
                {stats.completed}
              </Text>
            </Flex>
            <Flex>
              <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
                Failed
              </Text>
              <Text size="lg" fw={700} ff="monospace" c="red">
                {stats.failed}
              </Text>
            </Flex>
          </Flex>

          <Progress.Root size="sm" radius="xs">
            <Tooltip label={`${stats.completed} completed`}>
              <Progress.Section
                value={(stats.completed / Math.max(stats.total, 1)) * 100}
                color="teal"
              />
            </Tooltip>
            <Tooltip label={`${stats.failed} failed`}>
              <Progress.Section
                value={(stats.failed / Math.max(stats.total, 1)) * 100}
                color="red"
              />
            </Tooltip>
            <Tooltip label={`${stats.running} running`}>
              <Progress.Section
                value={(stats.running / Math.max(stats.total, 1)) * 100}
                color="blue"
              />
            </Tooltip>
          </Progress.Root>

          {stats.lastRun && (
            <Text size="xs" c="dimmed" mt="xs">
              Last run: {formatDuration(stats.lastRun, new Date())} ago
            </Text>
          )}
        </>
      ) : (
        <Flex direction="column" gap="xs">
          <Skeleton height={8} radius="xl" />
          <Skeleton height={8} width="70%" radius="xl" />
        </Flex>
      )}
    </Card>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Execution Log Viewer
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionLogViewerProps {
  logs?: LogEntry[];
  error?: string | null;
}

const ExecutionLogViewer = (props: ExecutionLogViewerProps) => {
  const { logs, error } = props;

  if (!logs?.length && !error) {
    return (
      <Flex p="md">
        <Text size="sm" c="dimmed" ta="center">
          No logs available
        </Text>
      </Flex>
    );
  }

  return (
    <ScrollArea h={300} type="auto">
      <Flex
        p="md"
        style={{
          fontFamily: "var(--mantine-font-family-monospace)",
          fontSize: "12px",
          lineHeight: 1.6,
        }}
      >
        {error && (
          <Paper p="sm" mb="md" bg="var(--mantine-color-red-light)" radius="sm">
            <Flex gap="xs" align="flex-start">
              <IconAlertTriangle
                size={14}
                color="var(--mantine-color-red-filled)"
              />
              <Text
                size="xs"
                c="red"
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {error}
              </Text>
            </Flex>
          </Paper>
        )}

        {logs?.map((log, index) => (
          <Flex key={index} gap="sm" align="flex-start" mb={4} wrap="nowrap">
            <Text size="xs" c="dimmed" style={{ minWidth: 80, flexShrink: 0 }}>
              {new Date(log.timestamp).toLocaleTimeString()}
            </Text>
            <Badge
              size="xs"
              variant="light"
              color={getLogLevelColor(log.level)}
              style={{ minWidth: 50 }}
            >
              {log.level}
            </Badge>
            <Text size="xs" c="dimmed" style={{ minWidth: 100, flexShrink: 0 }}>
              {log.module}
            </Text>
            <Text size="xs" style={{ wordBreak: "break-word" }}>
              {log.message}
            </Text>
          </Flex>
        ))}
      </Flex>
    </ScrollArea>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const AdminJobs = () => {
  const client = useClient<AdminJobController>();
  const { l } = useI18n();
  const toast = useToast();
  const dialog = useDialog();

  const [jobs, setJobs] = useState<string[]>([]);
  const [jobStats, setJobStats] = useState<Map<string, JobStats>>(new Map());
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [triggeringJobs, setTriggeringJobs] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string | null>("overview");

  // Load jobs list
  useEffect(() => {
    const loadJobs = async () => {
      try {
        const jobList = await client.getJobs();
        setJobs(jobList);

        // Load stats for each job
        const statsMap = new Map<string, JobStats>();
        for (const job of jobList) {
          const executions = await client.getJobExecutions({
            query: { job, size: 100 },
          });

          const items = executions.content || [];
          const completed = items.filter(
            (e: JobExecutionEntity) => e.status === "COMPLETED",
          ).length;
          const failed = items.filter(
            (e: JobExecutionEntity) => e.status === "FAILED",
          ).length;
          const running = items.filter(
            (e: JobExecutionEntity) => e.status === "STARTED",
          ).length;

          const completedItems = items.filter(
            (e: JobExecutionEntity) => e.status === "COMPLETED" && e.finishedAt,
          );
          const avgDuration =
            completedItems.length > 0
              ? completedItems.reduce((acc: number, e: JobExecutionEntity) => {
                  const duration =
                    new Date(e.finishedAt!).getTime() -
                    new Date(e.createdAt).getTime();
                  return acc + duration;
                }, 0) / completedItems.length
              : 0;

          const lastItem = items[0];

          statsMap.set(job, {
            name: job,
            total: items.length,
            completed,
            failed,
            running,
            avgDuration,
            lastRun: lastItem?.createdAt
              ? new Date(lastItem.createdAt)
              : undefined,
            lastStatus: lastItem?.status as JobStats["lastStatus"],
          });
        }

        setJobStats(statsMap);
      } catch (error) {
        toast.danger("Failed to load jobs");
      } finally {
        setLoading(false);
      }
    };

    loadJobs();
  }, [refreshKey]);

  const handleTriggerJob = useCallback(
    async (job: string) => {
      const confirmed = await dialog.confirm({
        title: "Trigger Job",
        message: `Are you sure you want to trigger "${job}" manually?`,
        confirmLabel: "Trigger",
        confirmColor: "blue",
      });

      if (!confirmed) return;

      setTriggeringJobs((prev) => new Set(prev).add(job));

      try {
        await client.triggerJob({ body: { name: job } });
        toast.success(`Job "${job}" triggered successfully`);
        setRefreshKey((k) => k + 1);
      } catch (error) {
        toast.danger(`Failed to trigger job "${job}"`);
      } finally {
        setTriggeringJobs((prev) => {
          const next = new Set(prev);
          next.delete(job);
          return next;
        });
      }
    },
    [client, dialog, toast],
  );

  const filters = t.object({
    job: t.optional(
      t.string({
        $control: {
          query: t.pick(jobExecutions.schema, ["job"]),
        },
      }),
    ),
    status: t.optional(t.enum(["STARTED", "FAILED", "COMPLETED"])),
  });

  // Calculate global stats
  const globalStats = {
    total: Array.from(jobStats.values()).reduce((acc, s) => acc + s.total, 0),
    completed: Array.from(jobStats.values()).reduce(
      (acc, s) => acc + s.completed,
      0,
    ),
    failed: Array.from(jobStats.values()).reduce((acc, s) => acc + s.failed, 0),
    running: Array.from(jobStats.values()).reduce(
      (acc, s) => acc + s.running,
      0,
    ),
  };

  const successRate =
    globalStats.total > 0
      ? Math.round((globalStats.completed / globalStats.total) * 100)
      : 0;

  return (
    <Flex flex={1} direction="column" gap="md">
      {/* Header Stats */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <Paper p="md" radius="md" withBorder>
          <Flex justify="space-between">
            <Flex>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Total Jobs
              </Text>
              <Text size="xl" fw={700} ff="monospace">
                {jobs.length}
              </Text>
            </Flex>
            <ThemeIcon size="lg" radius="md" variant="light" color="blue">
              <IconTerminal2 size={20} />
            </ThemeIcon>
          </Flex>
        </Paper>

        <Paper p="md" radius="md" withBorder>
          <Flex justify="space-between">
            <Flex>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Executions
              </Text>
              <Text size="xl" fw={700} ff="monospace">
                {globalStats.total}
              </Text>
            </Flex>
            <ThemeIcon size="lg" radius="md" variant="light" color="gray">
              <IconClock size={20} />
            </ThemeIcon>
          </Flex>
        </Paper>

        <Paper p="md" radius="md" withBorder>
          <Flex justify="space-between">
            <Flex>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Success Rate
              </Text>
              <Text
                size="xl"
                fw={700}
                ff="monospace"
                c={
                  successRate >= 90
                    ? "teal"
                    : successRate >= 70
                      ? "yellow"
                      : "red"
                }
              >
                {successRate}%
              </Text>
            </Flex>
            <RingProgress
              size={48}
              thickness={4}
              roundCaps
              sections={[
                {
                  value: successRate,
                  color:
                    successRate >= 90
                      ? "teal"
                      : successRate >= 70
                        ? "yellow"
                        : "red",
                },
              ]}
            />
          </Flex>
        </Paper>

        <Paper p="md" radius="md" withBorder>
          <Flex justify="space-between">
            <Flex>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Running Now
              </Text>
              <Text size="xl" fw={700} ff="monospace" c="blue">
                {globalStats.running}
              </Text>
            </Flex>
            <ThemeIcon
              size="lg"
              radius="md"
              variant="light"
              color={globalStats.running > 0 ? "blue" : "gray"}
            >
              <IconPlayerPlay size={20} />
            </ThemeIcon>
          </Flex>
        </Paper>
      </SimpleGrid>

      {/* Tabs */}
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconTerminal2 size={14} />}>
            Jobs Overview
          </Tabs.Tab>
          <Tabs.Tab value="executions" leftSection={<IconClock size={14} />}>
            Execution History
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <Flex justify="space-between" mb="md">
            <Text size="sm" c="dimmed">
              {jobs.length} registered job{jobs.length !== 1 ? "s" : ""}
            </Text>
            <ActionButton
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={14} />}
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              Refresh
            </ActionButton>
          </Flex>

          {loading ? (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} height={150} radius="md" />
              ))}
            </SimpleGrid>
          ) : jobs.length === 0 ? (
            <Paper p="xl" radius="md" withBorder ta="center">
              <IconTerminal2 size={48} color="var(--mantine-color-dimmed)" />
              <Text size="lg" fw={500} mt="md">
                No jobs registered
              </Text>
              <Text size="sm" c="dimmed" mt="xs">
                Jobs will appear here once they are defined using $job primitive
              </Text>
            </Paper>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {jobs.map((job) => (
                <JobCard
                  key={job}
                  job={job}
                  stats={jobStats.get(job)}
                  isTriggering={triggeringJobs.has(job)}
                  onTrigger={handleTriggerJob}
                  onSelect={setSelectedJob}
                  isSelected={selectedJob === job}
                />
              ))}
            </SimpleGrid>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="executions" pt="md">
          <DataTable<JobExecutionEntity, typeof filters>
            key={refreshKey}
            submitOnInit
            defaultSize={15}
            typeFormProps={{
              skipSubmitButton: true,
              columns: 3,
            }}
            tableProps={{
              horizontalSpacing: "sm",
              verticalSpacing: "sm",
              highlightOnHover: true,
            }}
            onFilterChange={(key, _value, form) => {
              if (key === "job" || key === "status") {
                return form.submit();
              }
            }}
            filters={filters}
            items={async (filters) => {
              const response = await client.getJobExecutions({
                query: {
                  ...filters,
                  job: selectedJob || filters.job,
                },
              });

              return response as Page<JobExecutionEntity>;
            }}
            columns={{
              job: {
                label: "Job",
                value: (item) => (
                  <Text size="sm" fw={500} ff="monospace">
                    {item.job}
                  </Text>
                ),
              },
              status: {
                label: "Status",
                fit: true,
                value: (item) => (
                  <Badge
                    size="sm"
                    variant="light"
                    color={getStatusColor(item.status)}
                    leftSection={getStatusIcon(item.status, 12)}
                  >
                    {item.status}
                  </Badge>
                ),
              },
              duration: {
                label: "Duration",
                fit: true,
                value: (item) => (
                  <Text size="xs" c="dimmed" ff="monospace">
                    {formatDuration(item.createdAt, item.finishedAt)}
                  </Text>
                ),
              },
              logs: {
                label: "Logs",
                fit: true,
                value: (item) => {
                  const logCount =
                    (item.logs as LogEntry[] | undefined)?.length || 0;
                  const errorCount =
                    (item.logs as LogEntry[] | undefined)?.filter(
                      (log) => log.level === "ERROR",
                    ).length || 0;

                  return (
                    <Flex gap={4}>
                      <Badge size="xs" variant="light" color="gray">
                        {logCount} logs
                      </Badge>
                      {errorCount > 0 && (
                        <Badge size="xs" variant="light" color="red">
                          {errorCount} errors
                        </Badge>
                      )}
                    </Flex>
                  );
                },
              },
              error: {
                label: "Error",
                value: (item) =>
                  item.error ? (
                    <Tooltip label={item.error} multiline w={300}>
                      <Text size="xs" c="red" lineClamp={1}>
                        {item.error}
                      </Text>
                    </Tooltip>
                  ) : (
                    <Text size="xs" c="dimmed">
                      —
                    </Text>
                  ),
              },
              createdAt: {
                label: "Started",
                fit: true,
                value: (item) => (
                  <Text size="xs" c="dimmed">
                    {l(item.createdAt, { date: "fromNow" })}
                  </Text>
                ),
              },
            }}
            panel={(item) => (
              <Flex bg="var(--mantine-color-dark-7)" p={0}>
                <ExecutionLogViewer
                  logs={item.logs as LogEntry[] | undefined}
                  error={item.error}
                />
              </Flex>
            )}
            canPanel={(item) => Boolean(item.logs?.length || item.error)}
          />
        </Tabs.Panel>
      </Tabs>
    </Flex>
  );
};

export default AdminJobs;
