import { useClient, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group, Tooltip } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { AuditController, AuditEntity } from "alepha/api/audits";

export interface AdminUserAuditsProps {
  userRealmName?: string;
}

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case "critical":
      return "red";
    case "warning":
      return "yellow";
    default:
      return "blue";
  }
};

const getSeverityIcon = (severity: string) => {
  switch (severity) {
    case "critical":
      return <IconAlertTriangle size={12} />;
    case "warning":
      return <IconAlertTriangle size={12} />;
    default:
      return <IconInfoCircle size={12} />;
  }
};

const AdminUserAudits = (_props: AdminUserAuditsProps) => {
  const state = useRouterState();
  const client = useClient<AuditController>();
  const { l } = useI18n();
  const userId = state.params.userId as string;

  const filters = t.object({
    type: t.optional(t.text()),
    action: t.optional(t.text()),
    severity: t.optional(t.enum(["info", "warning", "critical"])),
    success: t.optional(t.boolean()),
    from: t.optional(t.datetime()),
    to: t.optional(t.datetime()),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<AuditEntity, typeof filters>
        submitOnInit
        defaultSize={15}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 4,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
          striped: false,
          highlightOnHover: true,
        }}
        filters={filters}
        items={async (query) => {
          const response = await client.findByUser({
            params: { userId },
            query,
          });
          return response as Page<AuditEntity>;
        }}
        columns={{
          type: {
            label: "Type",
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="light" color="grape">
                {item.type}
              </Badge>
            ),
          },
          action: {
            label: "Action",
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="outline">
                {item.action}
              </Badge>
            ),
          },
          severity: {
            label: "Severity",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={getSeverityColor(item.severity)}
                leftSection={getSeverityIcon(item.severity)}
              >
                {item.severity}
              </Badge>
            ),
          },
          description: {
            label: "Description",
            value: (item) => (
              <Text size="sm" lineClamp={1}>
                {item.description || "-"}
              </Text>
            ),
          },
          resource: {
            label: "Resource",
            fit: true,
            value: (item) =>
              item.resourceType ? (
                <Tooltip label={item.resourceId || "N/A"}>
                  <Badge size="xs" variant="dot" color="gray">
                    {item.resourceType}
                  </Badge>
                </Tooltip>
              ) : (
                <Text size="xs" c="dimmed">
                  -
                </Text>
              ),
          },
          success: {
            label: "Status",
            fit: true,
            value: (item) =>
              item.success ? (
                <Group gap={4}>
                  <IconCheck size={14} color="var(--mantine-color-green-6)" />
                  <Text size="xs" c="green">
                    Success
                  </Text>
                </Group>
              ) : (
                <Tooltip label={item.errorMessage || "Failed"}>
                  <Group gap={4}>
                    <IconX size={14} color="var(--mantine-color-red-6)" />
                    <Text size="xs" c="red">
                      Failed
                    </Text>
                  </Group>
                </Tooltip>
              ),
          },
          ipAddress: {
            label: "IP",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace">
                {item.ipAddress || "-"}
              </Text>
            ),
          },
          createdAt: {
            label: "Time",
            fit: true,
            value: (item) => (
              <Tooltip label={l(item.createdAt, { date: "medium" })}>
                <Text size="xs" c="dimmed">
                  {l(item.createdAt, { date: "fromNow" })}
                </Text>
              </Tooltip>
            ),
          },
        }}
      />
    </Flex>
  );
};

export default AdminUserAudits;
