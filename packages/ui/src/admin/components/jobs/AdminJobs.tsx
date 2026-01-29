import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge } from "@mantine/core";
import {
  IconCheck,
  IconClock,
  IconPlayerPlay,
  IconX,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import {
  type AdminJobController,
  type JobExecutionEntity,
  jobExecutions,
} from "alepha/api/jobs";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

const AdminJobs = () => {
  const client = useClient<AdminJobController>();
  const { l } = useI18n();

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "green";
      case "FAILED":
        return "red";
      case "STARTED":
        return "blue";
      default:
        return "gray";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return <IconCheck size={12} />;
      case "FAILED":
        return <IconX size={12} />;
      case "STARTED":
        return <IconPlayerPlay size={12} />;
      default:
        return <IconClock size={12} />;
    }
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
    return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
  };

  return (
    <Flex flex={1} direction={"column"}>
      <DataTable<JobExecutionEntity, typeof filters>
        submitOnInit
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 3,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
        }}
        onFilterChange={(key, _value, form) => {
          if (key === "job" || key === "status") {
            return form.submit();
          }
        }}
        filters={filters}
        items={async (filters) => {
          const response = await client.getJobExecutions({
            query: filters,
          });

          return response as Page<JobExecutionEntity>;
        }}
        columns={{
          job: {
            label: "Job",
            value: (item) => (
              <Text size="sm" fw={500}>
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
                leftSection={getStatusIcon(item.status)}
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
          error: {
            label: "Error",
            value: (item) =>
              item.error ? (
                <Text size="xs" c="red" lineClamp={1}>
                  {item.error}
                </Text>
              ) : (
                <Text size="xs" c="dimmed">
                  -
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
      />
    </Flex>
  );
};

export default AdminJobs;
