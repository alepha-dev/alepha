import { ActionButton, Flex, Text, useToast } from "@alepha/mantine";
import { Badge, Table } from "@mantine/core";
import { IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import type { AdminJobController, JobRegistration } from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { AdminJobRouter } from "../AdminJobRouter.tsx";

const POLL_INTERVAL_MS = 30_000;

const AdminJobsList = () => {
  const client = useClient<AdminJobController>();
  const router = useRouter<AdminJobRouter>();
  const toast = useToast();
  const { l } = useI18n();
  const [jobs, setJobs] = useState<JobRegistration[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await client.listJobs();
      setJobs(data);
    } catch {
      toast.danger("Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [client, toast]);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const handleTrigger = useCallback(
    async (name: string) => {
      try {
        await client.triggerJob({ params: { name }, body: {} });
        toast.success(`Triggered ${name}`);
        load();
      } catch (e) {
        toast.danger(
          `Failed to trigger: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [client, load, toast],
  );

  return (
    <Flex p="md" flex={1} direction="column" gap="md">
      <Flex justify="space-between" align="center">
        <Flex direction="column">
          <Text size="lg" bold>
            Jobs
          </Text>
          <Text size="sm" muted>
            {jobs.length} registered job{jobs.length === 1 ? "" : "s"}
          </Text>
        </Flex>
        <ActionButton
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={load}
          loading={loading}
        >
          Refresh
        </ActionButton>
      </Flex>

      <Table
        striped
        highlightOnHover
        verticalSpacing="xs"
        horizontalSpacing="xs"
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Schedule</Table.Th>
            <Table.Th>Priority</Table.Th>
            <Table.Th>Last run</Table.Th>
            <Table.Th ta="right">OK</Table.Th>
            <Table.Th ta="right">Errors</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {jobs.map((job) => (
            <JobRow
              key={job.name}
              job={job}
              onOpen={() =>
                router.push("adminJobDetail", { params: { name: job.name } })
              }
              onTrigger={() => handleTrigger(job.name)}
              format={l}
            />
          ))}
          {!loading && jobs.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={8}>
                <Text muted ta="center" p="md">
                  No jobs registered.
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Flex>
  );
};

interface JobRowProps {
  job: JobRegistration;
  onOpen: () => void;
  onTrigger: () => void;
  format: ReturnType<typeof useI18n>["l"];
}

const JobRow = (props: JobRowProps) => {
  const job = props.job;
  const typeColor = job.type === "cron" ? "blue" : "violet";
  return (
    <Table.Tr style={{ cursor: "pointer" }} onClick={props.onOpen}>
      <Table.Td>
        <Flex direction="column">
          <Text size="sm" bold>
            {job.name}
          </Text>
          {job.description && (
            <Text size="xs" muted>
              {job.description}
            </Text>
          )}
        </Flex>
      </Table.Td>
      <Table.Td>
        <Badge size="sm" variant="light" color={typeColor}>
          {job.type}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Text size="xs" ff="monospace">
          {job.cron ?? "—"}
        </Text>
      </Table.Td>
      <Table.Td>
        <Badge size="xs" variant="default">
          {job.priority}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Text size="xs" muted>
          {job.recent.lastRun
            ? String(props.format(job.recent.lastRun, { date: "fromNow" }))
            : "never"}
        </Text>
      </Table.Td>
      <Table.Td ta="right">
        <Text size="sm" c={job.recent.ok > 0 ? "green" : undefined}>
          {job.recent.ok}
        </Text>
      </Table.Td>
      <Table.Td ta="right">
        <Text size="sm" c={job.recent.error > 0 ? "red" : undefined}>
          {job.recent.error}
        </Text>
      </Table.Td>
      <Table.Td ta="right">
        <ActionButton
          variant="subtle"
          size="xs"
          leftSection={<IconPlayerPlay size={14} />}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            props.onTrigger();
          }}
        >
          Trigger
        </ActionButton>
      </Table.Td>
    </Table.Tr>
  );
};

export default AdminJobsList;
