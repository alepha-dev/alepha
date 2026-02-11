import { DataTable, Flex, Text, useDialog, useToast } from "@alepha/ui";
import { Badge } from "@mantine/core";
import {
  IconCircleCheck,
  IconCircleX,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { t } from "alepha";
import type {
  AdminJobController,
  JobCronInfo,
  JobFailure,
  JobQueueDepth,
  JobRegistration,
} from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────

const getTypeColor = (type: string) => {
  switch (type) {
    case "cron":
      return "violet";
    case "push":
      return "blue";
    case "both":
      return "teal";
    default:
      return "gray";
  }
};

const registryFilters = t.object({
  type: t.optional(t.enum(["cron", "push", "both"])),
});

// ─────────────────────────────────────────────────────────────────────────────

const AdminJobRegistry = () => {
  const client = useClient<AdminJobController>();
  const { l } = useI18n();
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
        client.getQueueDepth(),
        client.getTopFailures(),
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
    <Flex flex={1} direction="column" gap="md">
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
          highlightOnHover: true,
        }}
        onFilterChange={(_key, _value, form) => form.submit()}
        filters={registryFilters}
        items={async (filters) => {
          const items = await client.getRegistry();
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
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="light" color={getTypeColor(item.type)}>
                {item.type}
              </Badge>
            ),
          },
          priority: {
            label: "Priority",
            fit: true,
            value: (item) => (
              <Text size="sm" tt="capitalize">
                {item.priority}
              </Text>
            ),
          },
          concurrency: {
            label: "Concurrency",
            fit: true,
            value: (item) => (
              <Text size="sm" ff="monospace">
                {item.concurrency}
              </Text>
            ),
          },
          queue: {
            label: "Queue",
            fit: true,
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
                    <Badge size="xs" variant="light" color="blue">
                      {q.running} run
                    </Badge>
                  )}
                  {q.pending > 0 && (
                    <Badge size="xs" variant="light" color="gray">
                      {q.pending} pen
                    </Badge>
                  )}
                  {q.retrying > 0 && (
                    <Badge size="xs" variant="light" color="yellow">
                      {q.retrying} retry
                    </Badge>
                  )}
                  {q.dead > 0 && (
                    <Badge size="xs" variant="light" color="red">
                      {q.dead} dead
                    </Badge>
                  )}
                </Flex>
              );
            },
          },
          actions: {
            label: "",
            fit: true,
            actions: (item) => [
              {
                tooltip: "Trigger",
                color: "blue",
                icon: IconPlayerPlay,
                onClick: () => handleTriggerJob(item.name),
              },
            ],
          },
        }}
        panel={(item) => {
          const cron = cronMap.get(item.name);
          const failure = failureMap.get(item.name);

          return (
            <Flex direction="column" gap="sm" p="sm">
              {/* Config */}
              <Flex gap="lg" wrap="wrap">
                {item.cron && (
                  <PanelField label="Cron" value={item.cron} monospace />
                )}
                {item.timeout && (
                  <PanelField label="Timeout" value={item.timeout} />
                )}
                {item.retry && (
                  <PanelField
                    label="Retry"
                    value={`${item.retry.retries}x${item.retry.hasBackoff ? " (backoff)" : ""}`}
                  />
                )}
                {item.batch && (
                  <PanelField
                    label="Batch"
                    value={`${item.batch.size} / ${item.batch.window}`}
                  />
                )}
                <PanelField
                  label="Schema"
                  value={item.hasSchema ? "Yes" : "No"}
                />
              </Flex>

              {/* Last cron execution */}
              {cron?.lastExecution && (
                <Flex gap="lg" wrap="wrap" align="center">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    Last Run
                  </Text>
                  <Flex align="center" gap={4}>
                    {cron.lastExecution.status === "completed" ? (
                      <IconCircleCheck
                        size={14}
                        color="var(--mantine-color-teal-6)"
                      />
                    ) : (
                      <IconCircleX
                        size={14}
                        color="var(--mantine-color-red-6)"
                      />
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
                    <Text size="xs" c="red" lineClamp={1}>
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
                  <Badge size="xs" variant="light" color="red">
                    {failure.failures}
                  </Badge>
                  {failure.lastError && (
                    <Text
                      size="xs"
                      c="dimmed"
                      lineClamp={1}
                      style={{ maxWidth: 400 }}
                    >
                      {failure.lastError}
                    </Text>
                  )}
                </Flex>
              )}
            </Flex>
          );
        }}
      />
    </Flex>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const PanelField = ({
  label,
  value,
  monospace,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) => (
  <Flex direction="column" gap={2}>
    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
      {label}
    </Text>
    <Text size="sm" ff={monospace ? "monospace" : undefined}>
      {value}
    </Text>
  </Flex>
);

export default AdminJobRegistry;
