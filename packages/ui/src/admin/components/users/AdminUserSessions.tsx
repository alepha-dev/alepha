import { DataTable, Flex, Text, useDialog } from "@alepha/ui";
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

const emptyFilters = t.object({});

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

const isExpired = (expiresAt: Date | string) =>
  new Date(expiresAt) < new Date();

const AdminUserSessions = (props: AdminUserSessionsProps) => {
  const state = useRouterState();
  const userId = state.params.userId as string;
  const client = useClient<AdminSessionController>();
  const { l } = useI18n();
  const dialog = useDialog();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleDeleteSession = async (sessionId: string) => {
    const confirmed = await dialog.confirm({
      title: "Revoke Session",
      message: "Are you sure you want to revoke this session?",
    });
    if (confirmed) {
      await client.deleteSession({
        params: { id: sessionId },
        query: { userRealmName: props.userRealmName },
      });
      setRefreshKey((k) => k + 1);
    }
  };

  return (
    <DataTable<SessionEntity, typeof emptyFilters>
      key={refreshKey}
      submitOnInit
      defaultSize={10}
      filters={emptyFilters}
      tableProps={{
        horizontalSpacing: "xs",
        verticalSpacing: "xs",
      }}
      tableTrProps={(item) => ({
        style: {
          opacity: isExpired(item.expiresAt) ? 0.5 : 1,
        },
      })}
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
        device: {
          label: "Device",
          value: (item) => (
            <Flex gap={4} align="center">
              {getDeviceIcon(item.userAgent?.device)}
              <Text size="xs">
                {item.userAgent
                  ? `${item.userAgent.browser} / ${item.userAgent.os}`
                  : "\u2014"}
              </Text>
            </Flex>
          ),
        },
        ip: {
          label: "IP",
          fit: true,
          value: (item) => (
            <Text size="xs" ff="monospace" c="dimmed">
              {item.ip || "\u2014"}
            </Text>
          ),
        },
        status: {
          label: "Status",
          fit: true,
          value: (item) => (
            <Text size="xs" c="dimmed">
              {isExpired(item.expiresAt) ? "Expired" : "Active"}
            </Text>
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
          actions: (item) => [
            {
              icon: <IconTrash size={14} />,
              onClick: () => handleDeleteSession(item.id),
              tooltip: "Revoke session",
            },
          ],
        },
      }}
    />
  );
};

export default AdminUserSessions;
