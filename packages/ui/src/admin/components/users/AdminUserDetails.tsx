import { ActionButton, ClipboardButton, Control } from "@alepha/ui";
import {
  Badge,
  Card,
  Center,
  Divider,
  Flex,
  Grid,
  Loader,
  Paper,
  SimpleGrid,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconActivity,
  IconCalendar,
  IconCheck,
  IconDevices,
  IconKey,
  IconShieldCheck,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { t } from "alepha";
import type { AdminUserController, UserEntity } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useRouterState } from "alepha/react/router";
import { type ReactNode, useEffect, useState } from "react";

export interface AdminUserDetailsProps {
  userRealmName?: string;
}

interface DataRowProps {
  label: string;
  value: ReactNode;
  copyValue?: string;
}

const DataRow = ({ label, value, copyValue }: DataRowProps) => (
  <Flex
    justify="space-between"
    py={8}
    wrap="nowrap"
    style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}
  >
    <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
      {label}
    </Text>
    <Flex gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      {typeof value === "string" ? (
        <Text size="sm" fw={500} truncate style={{ maxWidth: 220 }}>
          {value || "—"}
        </Text>
      ) : (
        value
      )}
      {copyValue && (
        <ClipboardButton
          value={copyValue}
          size="xs"
          variant="subtle"
          c="dimmed"
        />
      )}
    </Flex>
  </Flex>
);

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  color: string;
}

const StatCard = ({ icon, label, value, color }: StatCardProps) => (
  <Paper p="md" radius="md" withBorder>
    <Flex gap="sm">
      <ThemeIcon size="lg" radius="md" variant="light" color={color}>
        {icon}
      </ThemeIcon>
      <Flex>
        <Text size="xl" fw={700} lh={1}>
          {value}
        </Text>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
      </Flex>
    </Flex>
  </Paper>
);

const AdminUserDetails = (props: AdminUserDetailsProps) => {
  const state = useRouterState();
  const client = useClient<AdminUserController>();
  const { l } = useI18n();
  const userId = state.params.userId as string;

  const [user, setUser] = useState<UserEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

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
      setEditing(false);
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
      <Center flex={1} py="xl">
        <Loader />
      </Center>
    );
  }

  if (!user) {
    return (
      <Center flex={1} py="xl">
        <Flex direction="column" align="center" gap="xs">
          <IconUser size={48} opacity={0.3} />
          <Text c="dimmed">User not found</Text>
        </Flex>
      </Center>
    );
  }

  const displayName =
    user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`
      : user.firstName || user.lastName || null;

  return (
    <Flex direction="column" gap="md">
      {/* Stats Overview */}
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <StatCard
          icon={<IconDevices size={18} />}
          label="Sessions"
          value={0}
          color="blue"
        />
        <StatCard
          icon={<IconActivity size={18} />}
          label="API Calls"
          value={0}
          color="green"
        />
        <StatCard
          icon={<IconKey size={18} />}
          label="Failed Logins"
          value={0}
          color="orange"
        />
        <StatCard
          icon={<IconShieldCheck size={18} />}
          label="Roles"
          value={user.roles.length}
          color="violet"
        />
      </SimpleGrid>

      <Grid>
        {/* Left Column - Account Details */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card padding={0} radius="md" withBorder h="100%">
            <Flex justify="space-between" p="md" pb={0}>
              <Text fw={600} size="sm">
                Account Details
              </Text>
            </Flex>
            <Flex px="md" pb="md">
              <DataRow label="User ID" value={user.id} copyValue={user.id} />
              <DataRow
                label="Username"
                value={user.username || "—"}
                copyValue={user.username}
              />
              <DataRow
                label="Email"
                value={
                  <Flex gap={6}>
                    <Text size="sm" fw={500}>
                      {user.email || "—"}
                    </Text>
                    {user.email && (
                      <Badge
                        size="xs"
                        variant="light"
                        color={user.emailVerified ? "green" : "orange"}
                      >
                        {user.emailVerified ? "verified" : "unverified"}
                      </Badge>
                    )}
                  </Flex>
                }
                copyValue={user.email}
              />
              <DataRow
                label="Phone"
                value={user.phoneNumber || "—"}
                copyValue={user.phoneNumber}
              />
              <DataRow label="Realm" value={user.realm} />
              <DataRow
                label="Status"
                value={
                  <Flex gap={4}>
                    <ThemeIcon
                      size={16}
                      radius="xl"
                      color={user.enabled ? "green" : "red"}
                      variant="filled"
                    >
                      {user.enabled ? (
                        <IconCheck size={10} />
                      ) : (
                        <IconX size={10} />
                      )}
                    </ThemeIcon>
                    <Text size="sm" fw={500}>
                      {user.enabled ? "Active" : "Disabled"}
                    </Text>
                  </Flex>
                }
              />
            </Flex>
          </Card>
        </Grid.Col>

        {/* Right Column - Personal Info */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card padding={0} radius="md" withBorder h="100%">
            <Flex justify="space-between" p="md" pb={0}>
              <Text fw={600} size="sm">
                Personal Information
              </Text>
              {!editing && (
                <ActionButton
                  variant="subtle"
                  size="xs"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </ActionButton>
              )}
            </Flex>

            {editing ? (
              <Flex p="md">
                <form {...form.props}>
                  <Flex direction="column" gap="sm">
                    <SimpleGrid cols={2}>
                      <Control
                        title="First Name"
                        input={form.input.firstName}
                      />
                      <Control title="Last Name" input={form.input.lastName} />
                    </SimpleGrid>
                    <SimpleGrid cols={2}>
                      <Control title="Email" input={form.input.email} />
                      <Control title="Phone" input={form.input.phoneNumber} />
                    </SimpleGrid>
                    <Control title="Roles" input={form.input.roles} />
                    <Divider />
                    <Flex justify="flex-end" gap="xs">
                      <ActionButton
                        variant="subtle"
                        size="xs"
                        onClick={() => setEditing(false)}
                      >
                        Cancel
                      </ActionButton>
                      <ActionButton size="xs" form={form}>
                        Save
                      </ActionButton>
                    </Flex>
                  </Flex>
                </form>
              </Flex>
            ) : (
              <Flex px="md" pb="md">
                <DataRow label="First Name" value={user.firstName || "—"} />
                <DataRow label="Last Name" value={user.lastName || "—"} />
                <DataRow label="Display Name" value={displayName || "—"} />
                <DataRow
                  label="Roles"
                  value={
                    user.roles.length > 0 ? (
                      <Flex gap={4}>
                        {user.roles.map((role) => (
                          <Badge key={role} size="xs" variant="light">
                            {role}
                          </Badge>
                        ))}
                      </Flex>
                    ) : (
                      <Text size="sm" c="dimmed">
                        No roles
                      </Text>
                    )
                  }
                />
              </Flex>
            )}
          </Card>
        </Grid.Col>
      </Grid>

      {/* Timeline */}
      <Card padding={0} radius="md" withBorder>
        <Flex justify="space-between" p="md" pb={0}>
          <Text fw={600} size="sm">
            Activity Timeline
          </Text>
        </Flex>
        <SimpleGrid cols={{ base: 2, sm: 4 }} p="md">
          <Flex>
            <Flex gap={6} mb={4}>
              <IconCalendar size={14} style={{ opacity: 0.5 }} />
              <Text size="xs" c="dimmed">
                Created
              </Text>
            </Flex>
            <Text size="sm" fw={500}>
              {l(user.createdAt, { date: "ll" })}
            </Text>
            <Text size="xs" c="dimmed">
              {l(user.createdAt, { date: "fromNow" })}
            </Text>
          </Flex>
          <Flex>
            <Flex gap={6} mb={4}>
              <IconCalendar size={14} style={{ opacity: 0.5 }} />
              <Text size="xs" c="dimmed">
                Updated
              </Text>
            </Flex>
            <Text size="sm" fw={500}>
              {l(user.updatedAt, { date: "ll" })}
            </Text>
            <Text size="xs" c="dimmed">
              {l(user.updatedAt, { date: "fromNow" })}
            </Text>
          </Flex>
          <Flex>
            <Flex gap={6} mb={4}>
              <IconDevices size={14} style={{ opacity: 0.5 }} />
              <Text size="xs" c="dimmed">
                Last Login
              </Text>
            </Flex>
            <Text size="sm" c="dimmed">
              —
            </Text>
          </Flex>
          <Flex>
            <Flex gap={6} mb={4}>
              <IconCheck size={14} style={{ opacity: 0.5 }} />
              <Text size="xs" c="dimmed">
                Email Verified
              </Text>
            </Flex>
            {user.emailVerified ? (
              <>
                <Text size="sm" fw={500}>
                  {l(user.updatedAt, { date: "ll" })}
                </Text>
                <Text size="xs" c="dimmed">
                  {l(user.updatedAt, { date: "fromNow" })}
                </Text>
              </>
            ) : (
              <Text size="sm" c="dimmed">
                Not verified
              </Text>
            )}
          </Flex>
        </SimpleGrid>
      </Card>
    </Flex>
  );
};

export default AdminUserDetails;
