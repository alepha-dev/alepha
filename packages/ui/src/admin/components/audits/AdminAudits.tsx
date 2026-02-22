import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Tooltip } from "@mantine/core";
import { IconCheck, IconUser, IconX } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { AdminAuditController, AuditEntity } from "alepha/api/audits";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import type { AdminRouter } from "../../AdminRouter.ts";

export interface AdminAuditsProps {
  userRealmName?: string;
}

const AdminAudits = (props: AdminAuditsProps) => {
  const client = useClient<AdminAuditController>();
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
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="default">
                {item.type}
              </Badge>
            ),
          },
          action: {
            label: "Action",
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="default">
                {item.action}
              </Badge>
            ),
          },
          severity: {
            label: "Severity",
            fit: true,
            value: (item) => (
              <Text size="xs" tt="capitalize">
                {item.severity}
              </Text>
            ),
          },
          user: {
            label: "User",
            fit: true,
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
            fit: true,
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
            fit: true,
            value: (item) =>
              item.success ? (
                <IconCheck size={14} />
              ) : (
                <Tooltip label={item.errorMessage || "Failed"}>
                  <IconX size={14} />
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
