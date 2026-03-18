import {
  ActionButton,
  DataTable,
  Flex,
  Text,
  useDialog,
  useToast,
} from "@alepha/ui";
import { Badge } from "@mantine/core";
import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconTrash,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import {
  type AdminSessionController,
  type SessionEntity,
  sessions,
} from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";
import type { AdminRouter } from "../../AdminRouter.tsx";

export interface AdminSessionsProps {
  userRealmName?: string;
}

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

const isExpired = (expiresAt: Date | string) =>
  new Date(expiresAt) < new Date();

const AdminSessions = (props: AdminSessionsProps) => {
  const client = useClient<AdminSessionController>();
  const router = useRouter<AdminRouter>();
  const { l } = useI18n();
  const dialog = useDialog();
  const toast = useToast();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleDelete = async (session: SessionEntity) => {
    const confirmed = await dialog.confirm({
      title: "Revoke session",
      message:
        "Are you sure you want to revoke this session? The user will be signed out.",
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
    <Flex p="md" flex={1} direction="column">
      <DataTable<SessionEntity, typeof filters>
        key={refreshKey}
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
        onFilterChange={(_key, _value, form) => form.submit()}
        filters={filters}
        tableTrProps={(item) => ({
          style: {
            opacity: isExpired(item.expiresAt) ? 0.5 : 1,
          },
        })}
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
            label: "User",
            value: (item) => (
              <ActionButton
                variant="subtle"
                size="xs"
                href={router.path("adminUserProfile", {
                  params: { userId: item.userId },
                })}
              >
                <Text size="xs" ff="monospace">
                  {item.userId.slice(0, 8)}...
                </Text>
              </ActionButton>
            ),
          },
          userAgent: {
            label: "Device",
            value: (item) => (
              <Flex gap={4} align="center">
                {item.userAgent ? (
                  <>
                    {getDeviceIcon(item.userAgent.device)}
                    <Text size="xs">
                      {item.userAgent.browser} / {item.userAgent.os}
                    </Text>
                  </>
                ) : (
                  <Text size="xs" muted>
                    —
                  </Text>
                )}
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
          expiresAt: {
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
            onClick: () => handleDelete(item),
            visible: !isExpired(item.expiresAt),
          },
        ]}
      />
    </Flex>
  );
};

export default AdminSessions;
