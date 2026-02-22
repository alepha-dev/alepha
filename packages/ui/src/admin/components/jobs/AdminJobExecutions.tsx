import type { DetailListItem } from "@alepha/ui";
import {
  ActionButton,
  DataTable,
  DetailList,
  Flex,
  Text,
  useDialog,
  useToast,
} from "@alepha/ui";
import { Badge, Code, Paper, Table } from "@mantine/core";
import { IconCircleX, IconRefresh } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type {
  AdminJobController,
  JobExecutionDetailResource,
  JobExecutionResource,
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

const executionFilters = t.object({
  job: t.optional(t.string()),
  status: t.optional(
    t.enum([
      "pending",
      "scheduled",
      "retrying",
      "running",
      "completed",
      "failed",
      "dead",
      "cancelled",
    ]),
  ),
  priority: t.optional(t.enum(["critical", "high", "normal", "low"])),
});

// ─────────────────────────────────────────────────────────────────────────────

const AdminJobExecutions = () => {
  const client = useClient<AdminJobController>();
  const { l } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [refreshKey, setRefreshKey] = useState(0);

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

  return (
    <Flex flex={1} direction="column" gap="md">
      <DataTable<JobExecutionResource, typeof executionFilters>
        key={`executions-${refreshKey}`}
        submitOnInit
        defaultSize={20}
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
          if (key === "job" || key === "status" || key === "priority") {
            return form.submit();
          }
        }}
        filters={executionFilters}
        defaultFilters={["job", "status"]}
        items={async (filters) => {
          const response = await client.findJobExecutions({
            query: {
              ...filters,
            },
          });
          return response as Page<JobExecutionResource>;
        }}
        columns={{
          status: {
            label: "Status",
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="default">
                {item.status}
              </Badge>
            ),
          },
          jobName: {
            label: "Job",
            value: (item) => (
              <Text size="sm" fw={500} ff="monospace">
                {item.jobName}
              </Text>
            ),
          },
          priority: {
            label: "Priority",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {PRIORITY_LABELS[item.priority] ?? item.priority}
              </Text>
            ),
          },
          attempt: {
            label: "Attempt",
            fit: true,
            value: (item) => (
              <Text size="sm" ff="monospace">
                {item.attempt}/{item.maxAttempts}
              </Text>
            ),
          },
          triggeredByName: {
            label: "Trigger",
            fit: true,
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.triggeredByName ?? "\u2014"}
              </Text>
            ),
          },
          createdAt: {
            label: "Created",
            fit: true,
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
          startedAt: {
            label: "Started",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.startedAt
                  ? l(item.startedAt, { date: "fromNow" })
                  : "\u2014"}
              </Text>
            ),
          },
          duration: {
            label: "Duration",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace">
                {item.startedAt &&
                (item.completedAt || item.status === "running")
                  ? formatDuration(item.startedAt, item.completedAt)
                  : "\u2014"}
              </Text>
            ),
          },
          error: {
            label: "Error",
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {item.error ?? "\u2014"}
              </Text>
            ),
          },
          key: {
            label: "Key",
            fit: true,
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace">
                {item.key ?? "\u2014"}
              </Text>
            ),
          },
          workerId: {
            label: "Worker",
            fit: true,
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace">
                {item.workerId ?? "\u2014"}
              </Text>
            ),
          },
          actions: {
            label: "",
            fit: true,
            actions: (item) => [
              {
                tooltip: "Retry",
                icon: IconRefresh,
                onClick: () => handleRetry(item.id),
                visible: item.can?.retry,
              },
              {
                tooltip: "Cancel",
                icon: IconCircleX,
                onClick: () => handleCancel(item.id),
                visible: item.can?.cancel,
              },
            ],
          },
        }}
        panel={{
          can: (item) => Boolean(item.error || item.key || item.workerId),
          render: (item) => (
            <Flex direction="column" gap="sm" p="sm">
              {item.error && (
                <Flex direction="column" gap={2}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    Error
                  </Text>
                  <Paper p="xs" radius="sm" withBorder>
                    <Text
                      size="xs"
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {item.error}
                    </Text>
                  </Paper>
                </Flex>
              )}
              <Flex gap="lg" wrap="wrap">
                <Flex direction="column" gap={2}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    ID
                  </Text>
                  <Text size="xs" ff="monospace">
                    {item.id}
                  </Text>
                </Flex>
                {item.key && (
                  <Flex direction="column" gap={2}>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                      Key
                    </Text>
                    <Text size="xs" ff="monospace">
                      {item.key}
                    </Text>
                  </Flex>
                )}
                {item.workerId && (
                  <Flex direction="column" gap={2}>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                      Worker
                    </Text>
                    <Text size="xs" ff="monospace">
                      {item.workerId}
                    </Text>
                  </Flex>
                )}
                {item.triggeredByName && (
                  <Flex direction="column" gap={2}>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                      Triggered By
                    </Text>
                    <Text size="xs">{item.triggeredByName}</Text>
                  </Flex>
                )}
              </Flex>
            </Flex>
          ),
        }}
        drawer={(item) => (
          <ExecutionDetailContent
            item={item}
            onRetry={handleRetry}
            onCancel={handleCancel}
          />
        )}
      />
    </Flex>
  );
};

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
      <Paper p="sm" radius="md" withBorder>
        <Text size="sm" fw={600} mb="xs">
          Details
        </Text>
        <DetailList items={detailItems} columns={2} />
      </Paper>

      {/* Payload */}
      {detail.payload && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Payload
          </Text>
          <Code block>{JSON.stringify(detail.payload, null, 2)}</Code>
        </Paper>
      )}

      {/* Error */}
      {detail.error && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Error
          </Text>
          <Paper p="xs" radius="sm" withBorder>
            <Text
              size="sm"
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {detail.error}
            </Text>
          </Paper>
        </Paper>
      )}

      {/* Logs */}
      {detail.logs && detail.logs.length > 0 && (
        <Paper p="sm" radius="md" withBorder>
          <Text size="sm" fw={600} mb="xs">
            Logs ({detail.logs.length})
          </Text>
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
        </Paper>
      )}
    </Flex>
  );
};

export default AdminJobExecutions;
