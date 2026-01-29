import { ActionButton, DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group } from "@mantine/core";
import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconTrash,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type { AdminSessionController, SessionEntity } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";
import { useState } from "react";

export interface AdminUserSessionsProps {
  userRealmName?: string;
}

const AdminUserSessions = (props: AdminUserSessionsProps) => {
  const state = useRouterState();
  const client = useClient<AdminSessionController>();
  const { l } = useI18n();
  const userId = state.params.userId as string;
  const [refreshKey, setRefreshKey] = useState(0);

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

  const handleDelete = async (sessionId: string) => {
    await client.deleteSession({
      params: { id: sessionId },
      query: { userRealmName: props.userRealmName },
    });
    setRefreshKey((k) => k + 1);
  };

  const filters = t.object({});

  return (
    <Flex flex={1} direction="column">
      <DataTable<SessionEntity, typeof filters>
        key={refreshKey}
        submitOnInit
        defaultSize={10}
        filters={filters}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
        }}
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
              userId,
              userRealmName: props.userRealmName,
            },
          });

          return response as Page<SessionEntity>;
        }}
        columns={{
          userAgent: {
            label: "Device",
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
            label: "IP Address",
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
          actions: {
            label: "",
            fit: true,
            value: (item) => (
              <ActionButton
                size="xs"
                variant="subtle"
                color="red"
                onClick={() => handleDelete(item.id)}
              >
                <IconTrash size={14} />
              </ActionButton>
            ),
          },
        }}
      />
    </Flex>
  );
};

export default AdminUserSessions;
