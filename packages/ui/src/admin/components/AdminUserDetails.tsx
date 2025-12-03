import { useClient, useRouterState } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Control, Flex, Text } from "@alepha/ui";
import { Card, Group, Loader, Stack } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import { t } from "alepha";
import type { UserController, UserEntity } from "alepha/api/users";
import { useEffect, useState } from "react";

export interface AdminUserDetailsProps {
  userRealmName?: string;
}

const AdminUserDetails = (props: AdminUserDetailsProps) => {
  const state = useRouterState();
  const client = useClient<UserController>();
  const { l } = useI18n();
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

  const form = useForm({
    schema: t.object({
      email: t.optional(t.email()),
      phoneNumber: t.optional(t.e164()),
      firstName: t.optional(t.string()),
      lastName: t.optional(t.string()),
      roles: t.optional(t.array(t.string())),
      enabled: t.optional(t.boolean()),
    }),
    handler: async (data) => {
      const updated = await client.updateUser({
        params: { id: userId },
        query: { userRealmName: props.userRealmName },
        body: data,
      });
      setUser(updated);
    },
  });

  useEffect(() => {
    if (user) {
      form.input.email?.set(user.email ?? "");
      form.input.phoneNumber?.set(user.phoneNumber ?? "");
      form.input.firstName?.set(user.firstName ?? "");
      form.input.lastName?.set(user.lastName ?? "");
      form.input.roles?.set(user.roles ?? []);
      form.input.enabled?.set(user.enabled);
    }
  }, [user]);

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

  return (
    <Flex flex={1} direction="column" gap="md">
      <Card withBorder p="lg">
        <Stack gap="md">
          <Text size="lg" fw={500}>
            User Details
          </Text>

          <Group gap="xl">
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                User ID
              </Text>
              <Text size="sm" ff="monospace">
                {user.id}
              </Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Username
              </Text>
              <Text size="sm">{user.username || "-"}</Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Email Verified
              </Text>
              {user.emailVerified ? (
                <Group gap={4}>
                  <IconCheck size={14} color="var(--mantine-color-green-6)" />
                  <Text size="sm" c="green">
                    Verified
                  </Text>
                </Group>
              ) : (
                <Group gap={4}>
                  <IconX size={14} color="var(--mantine-color-red-6)" />
                  <Text size="sm" c="red">
                    Not Verified
                  </Text>
                </Group>
              )}
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Created
              </Text>
              <Text size="sm">{l(user.createdAt, { date: "medium" })}</Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Updated
              </Text>
              <Text size="sm">{l(user.updatedAt, { date: "medium" })}</Text>
            </Stack>
          </Group>
        </Stack>
      </Card>

      <Card withBorder p="lg">
        <form {...form.props}>
          <Stack gap="md">
            <Text size="lg" fw={500}>
              Edit User
            </Text>

            <Group grow>
              <Control title="Email" input={form.input.email} />
              <Control title="Phone Number" input={form.input.phoneNumber} />
            </Group>

            <Group grow>
              <Control title="First Name" input={form.input.firstName} />
              <Control title="Last Name" input={form.input.lastName} />
            </Group>

            <Control title="Roles" input={form.input.roles} />

            <Control title="Enabled" input={form.input.enabled} />

            <Group>
              <ActionButton form={form}>Save Changes</ActionButton>
            </Group>
          </Stack>
        </form>
      </Card>
    </Flex>
  );
};

export default AdminUserDetails;
