import { useClient } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group } from "@mantine/core";
import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import {
  type SessionController,
  type SessionEntity,
  sessions,
} from "alepha/api/users";

export interface AdminSessionsProps {
  userRealmName?: string;
}

const AdminSessions = (props: AdminSessionsProps) => {
  const client = useClient<SessionController>();
  const { l } = useI18n();

  const filters = t.object({
    userId: t.optional(
      t.uuid({
        $control: {
          query: t.pick(sessions.schema, ["userId"]),
        },
      }),
    ),
  });

  const getDeviceIcon = (device?: string) => {
    switch (device) {
      case "MOBILE":
        return <IconDeviceMobile size={14} />;
      case "TABLET":
        return <IconDeviceTablet size={14} />;
      default:
        return <IconDeviceDesktop size={14} />;
    }
  };

  const isExpired = (expiresAt: Date | string) => {
    return new Date(expiresAt) < new Date();
  };

  return (
    <Flex flex={1}>
      <DataTable<SessionEntity, typeof filters>
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
          if (key === "userId") {
            return form.submit();
          }
        }}
        filters={filters}
        tableTrProps={(item) => {
          if (isExpired(item.expiresAt)) {
            return {
              opacity: 0.5,
            };
          }
          return {};
        }}
        items={async (filters) => {
          const response = await client.findSessions({
            query: {
              ...filters,
              userRealmName: props.userRealmName,
            },
          });

          return response as Page<SessionEntity>;
        }}
        columns={{
          userId: {
            label: "User ID",
            value: (item) => (
              <Text size="xs" ff="monospace">
                {item.userId.slice(0, 8)}...
              </Text>
            ),
          },
          userAgent: {
            label: "Device",
            fit: true,
            value: (item) => (
              <Group gap={4}>
                {item.userAgent ? (
                  <>
                    <Badge
                      size="xs"
                      variant="light"
                      leftSection={getDeviceIcon(item.userAgent.device)}
                    >
                      {item.userAgent.device}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {item.userAgent.browser} / {item.userAgent.os}
                    </Text>
                  </>
                ) : (
                  <Text size="xs" c="dimmed">
                    -
                  </Text>
                )}
              </Group>
            ),
          },
          ip: {
            label: "IP",
            fit: true,
            value: (item) => (
              <Text size="xs" ff="monospace" c="dimmed">
                {item.ip || "-"}
              </Text>
            ),
          },
          expiresAt: {
            label: "Status",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={isExpired(item.expiresAt) ? "red" : "green"}
              >
                {isExpired(item.expiresAt) ? "Expired" : "Active"}
              </Badge>
            ),
          },
          createdAt: {
            label: "Created",
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

export default AdminSessions;
