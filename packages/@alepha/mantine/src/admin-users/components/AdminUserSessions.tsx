import { DataTable, Flex, Text, useDialog, useToast } from "@alepha/mantine";
import { Badge } from "@mantine/core";
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
  const toast = useToast();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleDeleteSession = async (session: SessionEntity) => {
    const confirmed = await dialog.confirm({
      title: "Revoke session",
      message:
        "Are you sure you want to revoke this session? The user will be signed out on this device.",
    });
    if (!confirmed) return;
    await client.deleteSession({
      params: { id: session.id },
      query: { userRealmName: props.userRealmName },
    });
    toast.success("Session revoked");
    setRefreshKey((k) => k + 1);
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
                  : "—"}
              </Text>
            </Flex>
          ),
        },
        ip: {
          label: "IP",
          value: (item) => (
            <Text size="xs" ff="monospace" muted>
              {item.ip || "—"}
            </Text>
          ),
        },
        status: {
          label: "Status",
          value: (item) => (
            <Badge
              size="sm"
              variant="light"
              color={isExpired(item.expiresAt) ? "gray" : "green"}
            >
              {isExpired(item.expiresAt) ? "Expired" : "Active"}
            </Badge>
          ),
        },
        createdAt: {
          label: "Created",
          value: (item) => (
            <Text size="xs" muted>
              {l(item.createdAt, { date: "fromNow" })}
            </Text>
          ),
        },
      }}
      rowActions={(item) => [
        {
          label: "Revoke session",
          icon: IconTrash,
          color: "red",
          onClick: () => handleDeleteSession(item),
          visible: !isExpired(item.expiresAt),
        },
      ]}
    />
  );
};

export default AdminUserSessions;
