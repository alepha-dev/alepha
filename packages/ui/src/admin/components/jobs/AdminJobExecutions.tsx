import { ActionButton, DataTable, Text, useDialog, useToast } from "@alepha/ui";
import { Badge, Code, Drawer, Flex, Paper, Table } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
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

const getLogLevelColor = (level: string) => {
  switch (level) {
    case "ERROR":
      return "red";
    case "WARN":
      return "orange";
    case "INFO":
      return "blue";
    case "DEBUG":
      return "gray";
    case "TRACE":
      return "dimmed";
    default:
      return "gray";
  }
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleRetry = useCallback(
    async (id: string) => {
      try {
        await client.retryExecution({ params: { id } });
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
        await client.cancelExecution({ params: { id } });
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
        tableTrProps={(item) => ({
          style: { cursor: "pointer" },
          onClick: () => setSelectedId(item.id),
        })}
        onFilterChange={(key, _value, form) => {
          if (key === "job" || key === "status" || key === "priority") {
            return form.submit();
          }
        }}
        filters={executionFilters}
        defaultFilters={["job", "status"]}
        items={async (filters) => {
          const response = await client.findExecutions({
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
                {item.triggeredByName ?? "—"}
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
                {item.startedAt ? l(item.startedAt, { date: "fromNow" }) : "—"}
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
                  : "—"}
              </Text>
            ),
          },
          error: {
            label: "Error",
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="red" lineClamp={1}>
                {item.error ?? "—"}
              </Text>
            ),
          },
          key: {
            label: "Key",
            fit: true,
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace">
                {item.key ?? "—"}
              </Text>
            ),
          },
          workerId: {
            label: "Worker",
            fit: true,
            defaultHidden: true,
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace">
                {item.workerId ?? "—"}
              </Text>
            ),
          },
          actions: {
            label: "",
            fit: true,
            actions: (item) => [
              {
                tooltip: "Retry",
                color: "blue",
                icon: IconRefresh,
                onClick: () => handleRetry(item.id),
                visible: item.can?.retry,
              },
              {
                tooltip: "Cancel",
                color: "red",
                icon: IconCircleX,
                onClick: () => handleCancel(item.id),
                visible: item.can?.cancel,
              },
            ],
          },
        }}
        panel={(item) => (
          <Flex direction="column" gap="sm" p="sm">
            {item.error && (
              <Flex direction="column" gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Error
                </Text>
                <Paper p="xs" bg="var(--mantine-color-red-light)" radius="sm">
                  <Text
                    size="xs"
                    c="red"
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
        )}
        canPanel={(item) => Boolean(item.error || item.key || item.workerId)}
      />

      <ExecutionDetailDrawer
        id={selectedId}
        onClose={() => setSelectedId(null)}
        onRetry={handleRetry}
        onCancel={handleCancel}
      />
    </Flex>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const ExecutionDetailDrawer = ({
  id,
  onClose,
  onRetry,
  onCancel,
}: {
  id: string | null;
  onClose: () => void;
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
        const data = await client.getExecution({ params: { id: execId } });
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
    if (id) loadDetail(id);
  }, [id, loadDetail]);

  const handleRetry = useCallback(async () => {
    if (!id) return;
    await onRetry(id);
    loadDetail(id);
  }, [id, onRetry, loadDetail]);

  const handleCancel = useCallback(async () => {
    if (!id) return;
    await onCancel(id);
    loadDetail(id);
  }, [id, onCancel, loadDetail]);

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

  return (
    <Drawer
      opened={id !== null}
      onClose={onClose}
      position="right"
      size="xl"
      title={
        detail ? (
          <Flex align="center" gap="sm">
            <Text fw={600} ff="monospace">
              {detail.jobName}
            </Text>
            <Badge
              size="sm"
              variant="light"
              color={getStatusColor(detail.status)}
              leftSection={getStatusIcon(detail.status, 12)}
            >
              {detail.status}
            </Badge>
            <Text size="xs" c="dimmed">
              {detail.attempt}/{detail.maxAttempts}
            </Text>
          </Flex>
        ) : (
          "Execution Detail"
        )
      }
    >
      {loading && (
        <Flex align="center" justify="center" py="xl">
          <Text c="dimmed">Loading...</Text>
        </Flex>
      )}
      {!loading && detail && (
        <Flex direction="column" gap="md">
          {/* Actions */}
          <Flex gap="xs">
            <ActionButton
              tooltip="Refresh"
              variant="light"
              size="xs"
              icon={IconRefresh}
              onClick={() => id && loadDetail(id)}
            />
            {detail.can?.retry && (
              <ActionButton
                tooltip="Retry"
                variant="light"
                size="xs"
                color="blue"
                icon={IconRefresh}
                onClick={handleRetry}
              />
            )}
            {detail.can?.cancel && (
              <ActionButton
                tooltip="Cancel"
                variant="light"
                size="xs"
                color="red"
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
            <Flex gap="lg" wrap="wrap">
              <DetailField label="ID" value={detail.id} monospace copyable />
              <DetailField label="Status" value={detail.status} capitalize />
              <DetailField
                label="Priority"
                value={PRIORITY_LABELS[detail.priority] ?? "Normal"}
              />
              <DetailField
                label="Attempt"
                value={`${detail.attempt}/${detail.maxAttempts}`}
                monospace
              />
              {detail.workerId && (
                <DetailField label="Worker" value={detail.workerId} monospace />
              )}
              {detail.key && (
                <DetailField label="Key" value={detail.key} monospace />
              )}
              <DetailField
                label="Created"
                value={String(l(detail.createdAt, { date: "lll" }))}
              />
              {detail.startedAt && (
                <DetailField
                  label="Started"
                  value={String(l(detail.startedAt, { date: "lll" }))}
                />
              )}
              {detail.startedAt &&
                (detail.completedAt || detail.status === "running") && (
                  <DetailField
                    label="Duration"
                    value={formatDuration(detail.startedAt, detail.completedAt)}
                    monospace
                  />
                )}
              {detail.triggeredByName && (
                <DetailField
                  label="Triggered By"
                  value={detail.triggeredByName}
                />
              )}
              {detail.cancelledByName && (
                <DetailField
                  label="Cancelled By"
                  value={detail.cancelledByName}
                />
              )}
            </Flex>
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
              <Text size="sm" fw={600} mb="xs" c="red">
                Error
              </Text>
              <Paper p="xs" bg="var(--mantine-color-red-light)" radius="sm">
                <Text
                  size="sm"
                  c="red"
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
                        onClick={
                          log.data ? () => toggleLogExpand(i) : undefined
                        }
                      >
                        <Table.Td>
                          <Badge
                            size="xs"
                            variant="light"
                            color={getLogLevelColor(log.level)}
                          >
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
      )}
    </Drawer>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const DetailField = ({
  label,
  value,
  monospace,
  capitalize,
  copyable,
}: {
  label: string;
  value: string;
  monospace?: boolean;
  capitalize?: boolean;
  copyable?: boolean;
}) => (
  <Flex direction="column" gap={2}>
    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
      {label}
    </Text>
    <Text
      size="sm"
      ff={monospace ? "monospace" : undefined}
      tt={capitalize ? "capitalize" : undefined}
      style={copyable ? { cursor: "pointer", userSelect: "all" } : undefined}
    >
      {value}
    </Text>
  </Flex>
);

export default AdminJobExecutions;
