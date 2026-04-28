import { ActionButton, Flex, Text, useDialog, useToast } from "@alepha/mantine";
import { Badge, Code, Modal, Table } from "@mantine/core";
import {
  IconArrowLeft,
  IconPlayerPlay,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import type { AdminJobController, JobExecutionResource } from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { AdminJobRouter } from "../AdminJobRouter.tsx";

const POLL_INTERVAL_MS = 10_000;

const STATUS_COLORS: Record<string, string> = {
  pending: "gray",
  running: "blue",
  scheduled: "yellow",
  ok: "green",
  error: "red",
  cancelled: "orange",
};

export interface AdminJobDetailProps {
  name: string;
}

const AdminJobDetail = (props: AdminJobDetailProps) => {
  const client = useClient<AdminJobController>();
  const router = useRouter<AdminJobRouter>();
  const dialog = useDialog();
  const toast = useToast();
  const { l } = useI18n();
  const name = props.name;

  const [executions, setExecutions] = useState<JobExecutionResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [openExecution, setOpenExecution] =
    useState<JobExecutionResource | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await client.listExecutions({ params: { name }, query: {} });
      setExecutions(data);
    } catch {
      toast.danger("Failed to load executions");
    } finally {
      setLoading(false);
    }
  }, [client, name, toast]);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const handleTrigger = useCallback(async () => {
    try {
      await client.triggerJob({ params: { name }, body: {} });
      toast.success(`Triggered ${name}`);
      load();
    } catch (e) {
      toast.danger(
        `Failed to trigger: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [client, load, name, toast]);

  const handleRetry = useCallback(
    async (id: string) => {
      if (
        !(await dialog.confirm({
          title: "Retry execution",
          message: "Re-run this execution with the original payload?",
        }))
      )
        return;
      try {
        await client.retryExecution({ params: { id } });
        toast.success("Retry queued");
        setOpenExecution(null);
        load();
      } catch (e) {
        toast.danger(
          `Failed to retry: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [client, dialog, load, toast],
  );

  const handleCancel = useCallback(
    async (id: string) => {
      if (
        !(await dialog.confirm({
          title: "Cancel execution",
          message: "Cancel this execution? If running, it will be aborted.",
        }))
      )
        return;
      try {
        await client.cancelExecution({ params: { id } });
        toast.success("Cancelled");
        setOpenExecution(null);
        load();
      } catch (e) {
        toast.danger(
          `Failed to cancel: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [client, dialog, load, toast],
  );

  return (
    <Flex p="md" flex={1} direction="column" gap="md">
      <Flex justify="space-between" align="center">
        <Flex direction="column">
          <Text size="lg" bold>
            {name}
          </Text>
          <Text size="sm" muted>
            Recent executions
          </Text>
        </Flex>
        <Flex gap="xs">
          <ActionButton
            variant="light"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => router.push("adminJobs")}
          >
            Back
          </ActionButton>
          <ActionButton
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={load}
            loading={loading}
          >
            Refresh
          </ActionButton>
          <ActionButton
            variant="filled"
            leftSection={<IconPlayerPlay size={16} />}
            onClick={handleTrigger}
          >
            Trigger
          </ActionButton>
        </Flex>
      </Flex>

      <Table
        striped
        highlightOnHover
        verticalSpacing="xs"
        horizontalSpacing="xs"
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Status</Table.Th>
            <Table.Th>Started</Table.Th>
            <Table.Th>Duration</Table.Th>
            <Table.Th>Attempt</Table.Th>
            <Table.Th>Error</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {executions.map((exec) => (
            <Table.Tr
              key={exec.id}
              style={{ cursor: "pointer" }}
              onClick={() => setOpenExecution(exec)}
            >
              <Table.Td>
                <Badge
                  size="sm"
                  variant="light"
                  color={STATUS_COLORS[exec.status] ?? "gray"}
                >
                  {exec.status}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="xs" muted>
                  {exec.startedAt
                    ? String(l(exec.startedAt, { date: "fromNow" }))
                    : "—"}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs" ff="monospace">
                  {formatDuration(exec.startedAt, exec.completedAt)}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">
                  {exec.attempt}/{exec.maxAttempts}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs" c={exec.error ? "red" : undefined} truncate>
                  {exec.error ?? "—"}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Flex gap="xs" justify="flex-end">
                  {exec.can.retry && (
                    <ActionButton
                      variant="subtle"
                      size="xs"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        handleRetry(exec.id);
                      }}
                    >
                      Retry
                    </ActionButton>
                  )}
                  {exec.can.cancel && (
                    <ActionButton
                      variant="subtle"
                      size="xs"
                      color="red"
                      leftSection={<IconX size={12} />}
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        handleCancel(exec.id);
                      }}
                    >
                      Cancel
                    </ActionButton>
                  )}
                </Flex>
              </Table.Td>
            </Table.Tr>
          ))}
          {!loading && executions.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={6}>
                <Text muted ta="center" p="md">
                  No executions yet.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Modal
        opened={openExecution !== null}
        onClose={() => setOpenExecution(null)}
        title="Execution detail"
        size="lg"
      >
        {openExecution && (
          <Flex direction="column" gap="md">
            <Flex gap="md" wrap="wrap">
              <Field label="ID" value={openExecution.id} mono />
              <Field
                label="Status"
                value={
                  <Badge
                    size="sm"
                    variant="light"
                    color={STATUS_COLORS[openExecution.status] ?? "gray"}
                  >
                    {openExecution.status}
                  </Badge>
                }
              />
              <Field
                label="Attempt"
                value={`${openExecution.attempt}/${openExecution.maxAttempts}`}
              />
            </Flex>

            {openExecution.error && (
              <Flex direction="column" gap={4}>
                <Text size="xs" muted>
                  Error
                </Text>
                <Code block c="red">
                  {openExecution.error}
                </Code>
              </Flex>
            )}

            {openExecution.payload && (
              <Flex direction="column" gap={4}>
                <Text size="xs" muted>
                  Payload
                </Text>
                <Code block>
                  {JSON.stringify(openExecution.payload, null, 2)}
                </Code>
              </Flex>
            )}

            {openExecution.logs && openExecution.logs.length > 0 && (
              <Flex direction="column" gap={4}>
                <Text size="xs" muted>
                  Logs ({openExecution.logs.length})
                </Text>
                <Code block style={{ maxHeight: 300, overflow: "auto" }}>
                  {openExecution.logs
                    .map(
                      (entry) =>
                        `[${entry.level}] ${entry.message}${entry.service ? ` (${entry.service})` : ""}`,
                    )
                    .join("\n")}
                </Code>
              </Flex>
            )}
          </Flex>
        )}
      </Modal>
    </Flex>
  );
};

interface FieldProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

const Field = (props: FieldProps) => (
  <Flex direction="column" gap={2}>
    <Text size="xs" muted>
      {props.label}
    </Text>
    <Text size="sm" ff={props.mono ? "monospace" : undefined}>
      {props.value}
    </Text>
  </Flex>
);

const formatDuration = (start?: string | null, end?: string | null): string => {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const d = e - s;
  if (d < 1000) return `${d}ms`;
  if (d < 60_000) return `${(d / 1000).toFixed(1)}s`;
  if (d < 3_600_000)
    return `${Math.floor(d / 60_000)}m ${Math.floor((d % 60_000) / 1000)}s`;
  return `${Math.floor(d / 3_600_000)}h ${Math.floor((d % 3_600_000) / 60_000)}m`;
};

export default AdminJobDetail;
