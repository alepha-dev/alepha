import { DataTable, Flex, Text } from "@alepha/mantine";
import { Badge, Tooltip } from "@mantine/core";
import { IconUser } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { AdminAuditController, AuditEntity } from "alepha/api/audits";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

export interface AdminAuditsProps {
  userRealmName?: string;
}

const AdminAudits = (props: AdminAuditsProps) => {
  const client = useClient<AdminAuditController>();
  const router = useRouter();
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
    <Flex p="md" flex={1} direction="column">
      <DataTable<AuditEntity, typeof filters>
        submitOnInit
        defaultSize={20}
        defaultFilters={["search", "severity"]}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 4,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
        }}
        onFilterChange={(_key, _value, form) => form.submit()}
        filters={filters}
        tableTrProps={(item) => ({
          style: {
            cursor: item.userId ? "pointer" : "default",
            opacity: item.success ? 1 : 0.85,
          },
          onClick: () => {
            if (item.userId) {
              router.push("adminUserProfile", {
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
            value: (item) => (
              <Badge size="sm" variant="default">
                {item.type}
              </Badge>
            ),
          },
          action: {
            label: "Action",
            value: (item) => (
              <Badge size="sm" variant="default">
                {item.action}
              </Badge>
            ),
          },
          severity: {
            label: "Severity",
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={
                  item.severity === "critical"
                    ? "red"
                    : item.severity === "warning"
                      ? "yellow"
                      : "gray"
                }
              >
                {item.severity}
              </Badge>
            ),
          },
          user: {
            label: "User",
            value: (item) =>
              item.userId ? (
                <Tooltip
                  label={
                    <Flex direction="column" gap={2}>
                      <Text size="xs">{item.userEmail || "No email"}</Text>
                      <Text size="xs" c="dimmed">
                        {item.userRealm || "default"}
                      </Text>
                    </Flex>
                  }
                >
                  <Flex gap={4}>
                    <IconUser size={12} />
                    <Text size="xs" lineClamp={1} maw={100}>
                      {item.userEmail?.split("@")[0] || item.userId.slice(0, 8)}
                    </Text>
                  </Flex>
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
            value: (item) =>
              item.resourceType ? (
                <Tooltip label={`${item.resourceType}: ${item.resourceId}`}>
                  <Text size="xs" ff="monospace">
                    {item.resourceType}
                  </Text>
                </Tooltip>
              ) : (
                <Text size="xs" c="dimmed">
                  -
                </Text>
              ),
          },
          success: {
            label: "Status",
            value: (item) =>
              item.success ? (
                <Badge size="sm" variant="light" color="green">
                  OK
                </Badge>
              ) : (
                <Tooltip label={item.errorMessage || "Failed"}>
                  <Badge size="sm" variant="light" color="red">
                    Failed
                  </Badge>
                </Tooltip>
              ),
          },
          ipAddress: {
            label: "IP",
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace">
                {item.ipAddress || "-"}
              </Text>
            ),
          },
          createdAt: {
            label: "Time",
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
