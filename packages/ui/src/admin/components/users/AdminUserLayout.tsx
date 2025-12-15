import {
  NestedView,
  useClient,
  useRouter,
  useRouterState,
} from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import { Avatar, Badge, Card, Group, Loader, Stack, Tabs } from "@mantine/core";
import { IconDevices, IconSettings, IconUser } from "@tabler/icons-react";
import type { UserController, UserEntity } from "alepha/api/users";
import { useEffect, useState } from "react";
import type { AdminRouter } from "../../AdminRouter.ts";

export interface AdminUserLayoutProps {
  userRealmName?: string;
}

const AdminUserLayout = (props: AdminUserLayoutProps) => {
  const router = useRouter<AdminRouter>();
  const state = useRouterState();
  const client = useClient<UserController>();
  const userId = state.params.userId as string;

  const [user, setUser] = useState<UserEntity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const data = await client.getUser({
          params: { id: userId },
          query: { userRealmName: props.userRealmName },
        });
        setUser(data);
      } finally {
        setLoading(false);
      }
    };

    loadUser();
  }, [userId]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!user) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">User not found</Text>
      </Flex>
    );
  }

  const currentPath = state.url.pathname;
  const detailsPath = router.path("adminUserDetails", { params: { userId } });
  const sessionsPath = router.path("adminUserSessions", { params: { userId } });
  const settingsPath = router.path("adminUserSettings", { params: { userId } });

  const getActiveTab = () => {
    if (currentPath.endsWith("/sessions")) return "sessions";
    if (currentPath.endsWith("/settings")) return "settings";
    return "details";
  };
  const activeTab = getActiveTab();

  const displayName =
    user.firstName || user.lastName
      ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
      : user.username || user.email || "User";

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      <Card withBorder p="md">
        <Group>
          <Avatar size="lg" radius="xl" color="blue">
            {displayName.charAt(0).toUpperCase()}
          </Avatar>
          <Stack gap={4}>
            <Group gap="xs">
              <Text size="lg" fw={500}>
                {displayName}
              </Text>
              <Badge
                size="sm"
                variant="light"
                color={user.enabled ? "green" : "red"}
              >
                {user.enabled ? "Active" : "Disabled"}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              {user.email || user.username || user.id}
            </Text>
            {user.roles.length > 0 && (
              <Group gap={4}>
                {user.roles.map((role: string) => (
                  <Badge key={role} size="xs" variant="outline">
                    {role}
                  </Badge>
                ))}
              </Group>
            )}
          </Stack>
        </Group>
      </Card>

      <Tabs value={activeTab}>
        <Tabs.List>
          <ActionButton
            href={detailsPath}
            leftSection={<IconUser size={16} />}
            c={activeTab === "details" ? undefined : "dimmed"}
            fw={activeTab === "details" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "details"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Details
          </ActionButton>
          <ActionButton
            href={sessionsPath}
            leftSection={<IconDevices size={16} />}
            c={activeTab === "sessions" ? undefined : "dimmed"}
            fw={activeTab === "sessions" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "sessions"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Sessions
          </ActionButton>
          <ActionButton
            href={settingsPath}
            leftSection={<IconSettings size={16} />}
            c={activeTab === "settings" ? undefined : "dimmed"}
            fw={activeTab === "settings" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "settings"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Settings
          </ActionButton>
        </Tabs.List>
      </Tabs>

      <Flex flex={1}>
        <NestedView />
      </Flex>
    </Flex>
  );
};

export default AdminUserLayout;
