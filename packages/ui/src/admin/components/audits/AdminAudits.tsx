import { useClient } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { useRouter } from "@alepha/react/router";
import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group, Stack, Tooltip } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconInfoCircle,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { AuditController, AuditEntity } from "alepha/api/audits";
import type { AdminRouter } from "../../AdminRouter.ts";

export interface AdminAuditsProps {
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

const getTypeColor = (type: string) => {
  switch (type) {
    case "auth":
      return "blue";
    case "user":
      return "grape";
    case "security":
      return "red";
    case "system":
      return "orange";
    case "access":
      return "cyan";
    case "payment":
      return "green";
    case "order":
      return "teal";
    default:
      return "gray";
  }
};

const AdminAudits = (props: AdminAuditsProps) => {
  const client = useClient<AuditController>();
  const router = useRouter<AdminRouter>();
  const { l } = useI18n();

  const filters = t.object({
    type: t.optional(t.text()),
    action: t.optional(t.text()),
    severity: t.optional(t.enum(["info", "warning", "critical"])),
    success: t.optional(t.boolean()),
    resourceType: t.optional(t.text()),
    search: t.optional(t.text()),
    from: t.optional(t.datetime()),
    to: t.optional(t.datetime()),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<AuditEntity, typeof filters>
        submitOnInit
        defaultSize={20}
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
        tableTrProps={(item) => ({
          style: {
            cursor: item.userId ? "pointer" : "default",
            opacity: item.success ? 1 : 0.85,
          },
          onClick: () => {
            if (item.userId) {
              router.go("adminUserDetails", {
                params: { userId: item.userId },
              });
            }
          },
        })}
        items={async (query) => {
          const response = await client.findAudits({
            query: {
              ...query,
              userRealm: props.userRealmName,
            },
          });
          return response as Page<AuditEntity>;
        }}
        columns={{
          type: {
            label: "Type",
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="light" color={getTypeColor(item.type)}>
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
                size="xs"
                variant="light"
                color={getSeverityColor(item.severity)}
                leftSection={getSeverityIcon(item.severity)}
              >
                {item.severity}
              </Badge>
            ),
          },
          user: {
            label: "User",
            fit: true,
            value: (item) =>
              item.userId ? (
                <Tooltip
                  label={
                    <Stack gap={2}>
                      <Text size="xs">{item.userEmail || "No email"}</Text>
                      <Text size="xs" c="dimmed">
                        {item.userRealm || "default"}
                      </Text>
                    </Stack>
                  }
                >
                  <Group gap={4}>
                    <IconUser size={12} />
                    <Text size="xs" lineClamp={1} maw={100}>
                      {item.userEmail?.split("@")[0] || item.userId.slice(0, 8)}
                    </Text>
                  </Group>
                </Tooltip>
              ) : (
                <Text size="xs" c="dimmed">
                  System
                </Text>
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
                <Tooltip label={`${item.resourceType}: ${item.resourceId}`}>
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
                <IconCheck size={14} color="var(--mantine-color-green-6)" />
              ) : (
                <Tooltip label={item.errorMessage || "Failed"}>
                  <IconX size={14} color="var(--mantine-color-red-6)" />
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

export default AdminAudits;
