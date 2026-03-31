import type { DetailListItem } from "@alepha/ui";
import {
  ActionButton,
  DataTable,
  DetailList,
  Flex,
  Section,
  Text,
  useDialog,
  useToast,
} from "@alepha/ui";
import { Badge, Code, Table } from "@mantine/core";
import {
  IconCircleCheck,
  IconCircleX,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type {
  AdminJobController,
  JobCronInfo,
  JobExecutionDetailResource,
  JobExecutionResource,
  JobFailure,
  JobQueueDepth,
  JobRegistration,
} from "alepha/api/jobs";
import type { LogEntry } from "alepha/logger";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, string> = {
  0: "Critical",
  1: "High",
  2: "Normal",
  3: "Low",
};

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

const registryFilters = t.object({
  type: t.optional(t.enum(["cron", "push", "both"])),
});

const emptyFilters = t.object({});

// ─────────────────────────────────────────────────────────────────────────────
// ExecutionDetailContent
// ─────────────────────────────────────────────────────────────────────────────

const ExecutionDetailContent = ({
  item,
  onRetry,
  onCancel,
}: {
  item: JobExecutionResource;
  onRetry: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) => {
  const client = useClient<AdminJobController>();
  const { l } = useI18n();
  const toast = useToast();
  const [detail, setDetail] = useState<JobExecutionDetailResource | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());

  const loadDetail = useCallback(
    async (execId: string) => {
      setDetail(null);
      setExpandedLogs(new Set());
      setLoading(true);
      try {
        const data = await client.getJobExecution({ params: { id: execId } });
        setDetail(data);
      } catch {
        toast.danger("Failed to load execution details");
      } finally {
        setLoading(false);
      }
    },
    [client, toast],
  );

  useEffect(() => {
    loadDetail(item.id);
  }, [item.id, loadDetail]);

  const handleRetry = useCallback(async () => {
    await onRetry(item.id);
    loadDetail(item.id);
  }, [item.id, onRetry, loadDetail]);

  const handleCancel = useCallback(async () => {
    await onCancel(item.id);
    loadDetail(item.id);
  }, [item.id, onCancel, loadDetail]);

  const toggleLogExpand = useCallback((index: number) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <Flex align="center" justify="center" py="xl">
        <Text c="dimmed">Loading...</Text>
      </Flex>
    );
  }

  if (!detail) return null;

  const detailItems: DetailListItem[] = [
    {
      label: "ID",
      value: (
        <Text size="sm" ff="monospace">
          {detail.id}
        </Text>
      ),
      copyable: detail.id,
    },
    {
      label: "Status",
      value: (
        <Text size="sm" tt="capitalize">
          {detail.status}
        </Text>
      ),
    },
    {
      label: "Priority",
      value: PRIORITY_LABELS[detail.priority] ?? "Normal",
    },
    {
      label: "Attempt",
      value: (
        <Text size="sm" ff="monospace">
          {detail.attempt}/{detail.maxAttempts}
        </Text>
      ),
    },
    {
      label: "Worker",
      value: (
        <Text size="sm" ff="monospace">
          {detail.workerId}
        </Text>
      ),
      hidden: !detail.workerId,
    },
    {
      label: "Key",
      value: (
        <Text size="sm" ff="monospace">
          {detail.key}
        </Text>
      ),
      hidden: !detail.key,
    },
    {
      label: "Created",
      value: String(l(detail.createdAt, { date: "lll" })),
    },
    {
      label: "Started",
      value: detail.startedAt
        ? String(l(detail.startedAt, { date: "lll" }))
        : undefined,
      hidden: !detail.startedAt,
    },
    {
      label: "Duration",
      value:
        detail.startedAt &&
        (detail.completedAt || detail.status === "running") ? (
          <Text size="sm" ff="monospace">
            {formatDuration(detail.startedAt, detail.completedAt)}
          </Text>
        ) : undefined,
      hidden: !(
        detail.startedAt &&
        (detail.completedAt || detail.status === "running")
      ),
    },
    {
      label: "Triggered By",
      value: detail.triggeredByName,
      hidden: !detail.triggeredByName,
    },
    {
      label: "Cancelled By",
      value: detail.cancelledByName,
      hidden: !detail.cancelledByName,
    },
  ];

  return (
    <Flex direction="column" gap="md">
      {/* Header */}
      <Flex align="center" gap="sm">
        <Text fw={600} ff="monospace">
          {detail.jobName}
        </Text>
        <Text size="sm" tt="capitalize" c="dimmed">
          {detail.status}
        </Text>
        <Text size="xs" c="dimmed">
          {detail.attempt}/{detail.maxAttempts}
        </Text>
      </Flex>

      {/* Actions */}
      <Flex gap="xs">
        <ActionButton
          tooltip="Refresh"
          variant="light"
          size="xs"
          icon={IconRefresh}
          onClick={() => loadDetail(item.id)}
        />
        {detail.can?.retry && (
          <ActionButton
            tooltip="Retry"
            variant="light"
            size="xs"
            icon={IconRefresh}
            onClick={handleRetry}
          />
        )}
        {detail.can?.cancel && (
          <ActionButton
            tooltip="Cancel"
            variant="light"
            size="xs"
            icon={IconCircleX}
            onClick={handleCancel}
          />
        )}
      </Flex>

      {/* Details */}
      <Section title="Details" p="sm">
        <DetailList items={detailItems} columns={2} />
      </Section>

      {/* Payload */}
      {detail.payload && (
        <Section title="Payload" p="sm">
          <Code block>{JSON.stringify(detail.payload, null, 2)}</Code>
        </Section>
      )}

      {/* Error */}
      {detail.error && (
        <Section title="Error" p="sm">
          <Text
            size="sm"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {detail.error}
          </Text>
        </Section>
      )}

      {/* Logs */}
      {detail.logs && detail.logs.length > 0 && (
        <Section title={`Logs (${detail.logs.length})`} p="sm">
          <Flex
            direction="column"
            style={{ maxHeight: 400, overflowY: "auto" }}
          >
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 60 }}>Level</Table.Th>
                  <Table.Th style={{ width: 90 }}>Time</Table.Th>
                  <Table.Th>Message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {detail.logs.map((log: LogEntry, i: number) => (
                  <Table.Tr
                    key={i}
                    style={log.data ? { cursor: "pointer" } : undefined}
                    onClick={log.data ? () => toggleLogExpand(i) : undefined}
                  >
                    <Table.Td>
                      <Badge size="xs" variant="default">
                        {log.level}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{log.message}</Text>
                      {expandedLogs.has(i) && log.data && (
                        <Code block mt="xs">
                          {JSON.stringify(log.data, null, 2)}
                        </Code>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Flex>
        </Section>
      )}
    </Flex>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// JobExecutionsPanel
// ─────────────────────────────────────────────────────────────────────────────

const JobExecutionsPanel = ({
  item,
  cronMap,
  failureMap,
}: {
  item: JobRegistration;
  cronMap: Map<string, JobCronInfo>;
  failureMap: Map<string, JobFailure>;
}) => {
  const client = useClient<AdminJobController>();
  const { l } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [refreshKey, setRefreshKey] = useState(0);

  const cron = cronMap.get(item.name);
  const failure = failureMap.get(item.name);

  const handleRetry = useCallback(
    async (id: string) => {
      try {
        await client.retryJobExecution({ params: { id } });
        toast.success("Execution retried");
        setRefreshKey((k) => k + 1);
      } catch {
        toast.danger("Failed to retry execution");
      }
    },
    [client, toast],
  );

  const handleCancel = useCallback(
    async (id: string) => {
      const confirmed = await dialog.confirm({
        title: "Cancel Execution",
        message: "Are you sure you want to cancel this execution?",
        confirmLabel: "Cancel",
        confirmColor: "red",
      });

      if (!confirmed) return;

      try {
        await client.cancelJobExecution({ params: { id } });
        toast.success("Execution cancelled");
        setRefreshKey((k) => k + 1);
      } catch {
        toast.danger("Failed to cancel execution");
      }
    },
    [client, dialog, toast],
  );

  const detailItems: DetailListItem[] = [
    {
      label: "Cron",
      value: item.cron ? (
        <Text size="sm" ff="monospace">
          {item.cron}
        </Text>
      ) : undefined,
      hidden: !item.cron,
    },
    {
      label: "Timeout",
      value: item.timeout,
      hidden: !item.timeout,
    },
    {
      label: "Retry",
      value: item.retry
        ? `${item.retry.retries}x${item.retry.hasBackoff ? " (backoff)" : ""}`
        : undefined,
      hidden: !item.retry,
    },
    {
      label: "Batch",
      value: item.batch
        ? `${item.batch.size} / ${item.batch.window}`
        : undefined,
      hidden: !item.batch,
    },
    {
      label: "Schema",
      value: item.hasSchema ? "Yes" : "No",
    },
  ];

  return (
    <Flex direction="column" gap="sm" p="sm">
      {/* Last cron execution */}
      {cron?.lastExecution && (
        <Flex gap="lg" wrap="wrap" align="center">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Last Run
          </Text>
          <Flex align="center" gap={4}>
            {cron.lastExecution.status === "completed" ? (
              <IconCircleCheck size={14} color="var(--mantine-color-dimmed)" />
            ) : (
              <IconCircleX size={14} color="var(--mantine-color-dimmed)" />
            )}
            <Text size="xs" tt="capitalize">
              {cron.lastExecution.status}
            </Text>
          </Flex>
          {cron.lastExecution.startedAt && (
            <Text size="xs" c="dimmed">
              {l(cron.lastExecution.startedAt, { date: "fromNow" })}
            </Text>
          )}
          {cron.lastExecution.error && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {cron.lastExecution.error}
            </Text>
          )}
        </Flex>
      )}

      {/* Failures */}
      {failure && (
        <Flex gap="lg" wrap="wrap" align="center">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Failures (7d)
          </Text>
          <Text size="xs" fw={500}>
            {failure.failures}
          </Text>
          {failure.lastError && (
            <Text size="xs" c="dimmed" lineClamp={1} style={{ maxWidth: 400 }}>
              {failure.lastError}
            </Text>
          )}
        </Flex>
      )}

      {/* Job config */}
      <DetailList items={detailItems} columns={3} />

      {/* Executions table */}
      <DataTable<JobExecutionResource, typeof emptyFilters>
        key={`executions-${item.name}-${refreshKey}`}
        submitOnInit
        defaultSize={10}
        tableProps={{
          horizontalSpacing: "sm",
          verticalSpacing: "sm",
        }}
        items={async () => {
          const response = await client.findJobExecutions({
            query: { job: item.name },
          });
          return response as Page<JobExecutionResource>;
        }}
        columns={{
          status: {
            label: "Status",
            value: (exec) => {
              const color =
                exec.status === "completed"
                  ? "green"
                  : exec.status === "running"
                    ? "blue"
                    : exec.status === "failed" || exec.status === "dead"
                      ? "red"
                      : exec.status === "cancelled"
                        ? "yellow"
                        : "gray";
              return (
                <Badge size="sm" variant="light" color={color}>
                  {exec.status}
                </Badge>
              );
            },
          },
          jobName: {
            label: "Job",
            value: (exec) => (
              <Text size="sm" fw={500} ff="monospace">
                {exec.jobName}
              </Text>
            ),
          },
          attempt: {
            label: "Attempt",
            value: (exec) => (
              <Text size="sm" ff="monospace">
                {exec.attempt}/{exec.maxAttempts}
              </Text>
            ),
          },
          startedAt: {
            label: "Started",
            value: (exec) => (
              <Text size="xs" c="dimmed">
                {exec.startedAt
                  ? l(exec.startedAt, { date: "fromNow" })
                  : "\u2014"}
              </Text>
            ),
          },
          duration: {
            label: "Duration",
            value: (exec) => (
              <Text size="xs" c="dimmed" ff="monospace">
                {exec.startedAt &&
                (exec.completedAt || exec.status === "running")
                  ? formatDuration(exec.startedAt, exec.completedAt)
                  : "\u2014"}
              </Text>
            ),
          },
        }}
        rowActions={(exec) => [
          {
            label: "Retry",
            icon: IconRefresh,
            onClick: () => handleRetry(exec.id),
            visible: exec.can?.retry,
          },
          {
            label: "Cancel",
            icon: IconCircleX,
            onClick: () => handleCancel(exec.id),
            visible: exec.can?.cancel,
          },
        ]}
        drawer={(exec) => (
          <ExecutionDetailContent
            item={exec}
            onRetry={handleRetry}
            onCancel={handleCancel}
          />
        )}
      />
    </Flex>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// AdminJobs (main page)
// ─────────────────────────────────────────────────────────────────────────────

const AdminJobs = () => {
  const client = useClient<AdminJobController>();
  const toast = useToast();
  const dialog = useDialog();
  const [refreshKey, setRefreshKey] = useState(0);

  // Extra data for enriched panels
  const [cronMap, setCronMap] = useState<Map<string, JobCronInfo>>(new Map());
  const [queueMap, setQueueMap] = useState<Map<string, JobQueueDepth>>(
    new Map(),
  );
  const [failureMap, setFailureMap] = useState<Map<string, JobFailure>>(
    new Map(),
  );

  const loadExtraData = useCallback(async () => {
    try {
      const [cronData, queueData, failureData] = await Promise.all([
        client.getCronJobs(),
        client.getJobQueueDepth(),
        client.getJobTopFailures(),
      ]);
      setCronMap(new Map(cronData.map((c) => [c.name, c])));
      setQueueMap(new Map(queueData.map((q) => [q.jobName, q])));
      setFailureMap(new Map(failureData.map((f) => [f.jobName, f])));
    } catch {
      // non-critical
    }
  }, [client]);

  useEffect(() => {
    loadExtraData();
  }, [loadExtraData, refreshKey]);

  const handleTriggerJob = useCallback(
    async (name: string) => {
      const confirmed = await dialog.confirm({
        title: "Trigger Job",
        message: `Are you sure you want to trigger "${name}" manually?`,
        confirmLabel: "Trigger",
        confirmColor: "blue",
      });

      if (!confirmed) return;

      return client.triggerJob({ body: { name } }).then(() => {
        toast.success(`Job "${name}" triggered`);
        setRefreshKey((k) => k + 1);
      });
    },
    [client, dialog, toast],
  );

  return (
    <Flex p="md" flex={1} direction="column" gap="md">
      <DataTable<JobRegistration, typeof registryFilters>
        key={`registry-${refreshKey}`}
        submitOnInit
        typeFormProps={{
          skipSubmitButton: true,
          columns: 1,
        }}
        tableProps={{
          horizontalSpacing: "sm",
          verticalSpacing: "sm",
        }}
        onFilterChange={(_key, _value, form) => form.submit()}
        filters={registryFilters}
        items={async (filters) => {
          const items = await client.getJobRegistry();
          const filtered = filters.type
            ? items.filter((i) => i.type === filters.type)
            : items;
          return { content: filtered };
        }}
        columns={{
          name: {
            label: "Name",
            value: (item) => (
              <Text size="sm" fw={500} ff="monospace">
                {item.name}
              </Text>
            ),
          },
          type: {
            label: "Type",
            value: (item) => (
              <Badge size="sm" variant="default">
                {item.type}
              </Badge>
            ),
          },
          priority: {
            label: "Priority",
            value: (item) => (
              <Text size="sm" tt="capitalize">
                {item.priority}
              </Text>
            ),
          },
          concurrency: {
            label: "Concurrency",
            value: (item) => (
              <Text size="sm" ff="monospace">
                {item.concurrency}
              </Text>
            ),
          },
          queue: {
            label: "Queue",
            value: (item) => {
              const q = queueMap.get(item.name);
              if (
                !q ||
                q.pending + q.running + q.scheduled + q.retrying + q.dead === 0
              ) {
                return (
                  <Text size="xs" c="dimmed">
                    —
                  </Text>
                );
              }
              return (
                <Flex gap={4}>
                  {q.running > 0 && (
                    <Badge size="xs" variant="default">
                      {q.running} run
                    </Badge>
                  )}
                  {q.pending > 0 && (
                    <Badge size="xs" variant="default">
                      {q.pending} pen
                    </Badge>
                  )}
                  {q.retrying > 0 && (
                    <Badge size="xs" variant="default">
                      {q.retrying} retry
                    </Badge>
                  )}
                  {q.dead > 0 && (
                    <Badge size="xs" variant="default">
                      {q.dead} dead
                    </Badge>
                  )}
                </Flex>
              );
            },
          },
        }}
        rowActions={(item) => [
          {
            label: "Trigger",
            color: "blue",
            icon: IconPlayerPlay,
            onClick: () => handleTriggerJob(item.name),
          },
        ]}
        panel={(item) => (
          <JobExecutionsPanel
            item={item}
            cronMap={cronMap}
            failureMap={failureMap}
          />
        )}
      />
    </Flex>
  );
};

export default AdminJobs;
