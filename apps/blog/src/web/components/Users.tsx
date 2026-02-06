import {
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Menu,
  Pagination,
  SegmentedControl,
  Select,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconBan,
  IconDotsVertical,
  IconEdit,
  IconEye,
  IconPlus,
  IconSearch,
  IconShield,
  IconTrash,
  IconUserOff,
} from "@tabler/icons-react";
import { Link } from "alepha/react/router";
import { useState } from "react";

type Role = "Admin" | "Editor" | "Author" | "Contributor" | "Subscriber";
type Status = "active" | "inactive" | "suspended";

interface User {
  id: number;
  name: string;
  email: string;
  avatar: string;
  role: Role;
  status: Status;
  lastLogin: string;
  posts: number;
}

const users: User[] = [
  {
    id: 1,
    name: "Nicolas Fournier",
    email: "nicolas@alepha.dev",
    avatar: "NF",
    role: "Admin",
    status: "active",
    lastLogin: "Feb 5, 2026",
    posts: 24,
  },
  {
    id: 2,
    name: "Marie Laurent",
    email: "marie@alepha.dev",
    avatar: "ML",
    role: "Editor",
    status: "active",
    lastLogin: "Feb 4, 2026",
    posts: 18,
  },
  {
    id: 3,
    name: "Alex Kowalski",
    email: "alex.k@example.com",
    avatar: "AK",
    role: "Author",
    status: "active",
    lastLogin: "Feb 3, 2026",
    posts: 12,
  },
  {
    id: 4,
    name: "Sarah Mitchell",
    email: "sarah.m@example.com",
    avatar: "SM",
    role: "Author",
    status: "active",
    lastLogin: "Feb 2, 2026",
    posts: 9,
  },
  {
    id: 5,
    name: "James Chen",
    email: "james.chen@example.com",
    avatar: "JC",
    role: "Contributor",
    status: "inactive",
    lastLogin: "Jan 15, 2026",
    posts: 3,
  },
  {
    id: 6,
    name: "Emily Rodriguez",
    email: "emily.r@example.com",
    avatar: "ER",
    role: "Editor",
    status: "active",
    lastLogin: "Feb 5, 2026",
    posts: 15,
  },
  {
    id: 7,
    name: "David Park",
    email: "david.park@example.com",
    avatar: "DP",
    role: "Subscriber",
    status: "inactive",
    lastLogin: "Dec 20, 2025",
    posts: 0,
  },
  {
    id: 8,
    name: "Lisa Thompson",
    email: "lisa.t@example.com",
    avatar: "LT",
    role: "Contributor",
    status: "suspended",
    lastLogin: "Jan 10, 2026",
    posts: 2,
  },
  {
    id: 9,
    name: "Marcus Webb",
    email: "marcus.w@example.com",
    avatar: "MW",
    role: "Author",
    status: "active",
    lastLogin: "Feb 1, 2026",
    posts: 7,
  },
  {
    id: 10,
    name: "Priya Sharma",
    email: "priya.s@example.com",
    avatar: "PS",
    role: "Subscriber",
    status: "suspended",
    lastLogin: "Jan 5, 2026",
    posts: 0,
  },
];

const statusColor: Record<Status, string> = {
  active: "teal",
  inactive: "gray",
  suspended: "red",
};

const roleColor: Record<Role, string> = {
  Admin: "violet",
  Editor: "blue",
  Author: "cyan",
  Contributor: "orange",
  Subscriber: "gray",
};

const Users = () => {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<number[]>([]);

  const filtered =
    filter === "all" ? users : users.filter((u) => u.status === filter);

  const toggleSelect = (id: number) => {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  };

  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2} fw={600}>
          Users
        </Title>
        <Button
          component={Link}
          href="/users/new"
          leftSection={<IconPlus size={14} />}
          color="orange"
          size="sm"
        >
          Add User
        </Button>
      </Group>

      {/* Filters bar */}
      <Group justify="space-between" mb="md">
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={setFilter}
          data={[
            { value: "all", label: `All (${users.length})` },
            {
              value: "active",
              label: `Active (${users.filter((u) => u.status === "active").length})`,
            },
            {
              value: "inactive",
              label: `Inactive (${users.filter((u) => u.status === "inactive").length})`,
            },
            {
              value: "suspended",
              label: `Suspended (${users.filter((u) => u.status === "suspended").length})`,
            },
          ]}
        />
        <Group gap="sm">
          <TextInput
            placeholder="Search users..."
            leftSection={<IconSearch size={14} />}
            size="xs"
            w={220}
          />
          <Select
            placeholder="Role"
            data={[
              "All Roles",
              "Admin",
              "Editor",
              "Author",
              "Contributor",
              "Subscriber",
            ]}
            size="xs"
            w={160}
            clearable
          />
        </Group>
      </Group>

      {/* Bulk actions */}
      {selected.length > 0 && (
        <Group gap="sm" mb="sm">
          <Text size="xs" c="dimmed">
            {selected.length} selected
          </Text>
          <Button
            variant="subtle"
            color="red"
            size="xs"
            leftSection={<IconTrash size={12} />}
            onClick={() =>
              modals.openConfirmModal({
                title: "Delete users",
                children: (
                  <Text size="sm">
                    Are you sure you want to delete {selected.length} selected
                    users? This action cannot be undone.
                  </Text>
                ),
                labels: { confirm: "Delete", cancel: "Cancel" },
                confirmProps: { color: "red" },
                onConfirm: () => {
                  notifications.show({
                    title: "Users Deleted",
                    message: `${selected.length} users have been deleted.`,
                    color: "red",
                  });
                  setSelected([]);
                },
              })
            }
          >
            Delete
          </Button>
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<IconShield size={12} />}
            onClick={() => {
              notifications.show({
                title: "Role Updated",
                message: `Role changed for ${selected.length} users.`,
                color: "blue",
              });
              setSelected([]);
            }}
          >
            Change Role
          </Button>
        </Group>
      )}

      {/* Users table */}
      <Box
        style={{
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <Table
          highlightOnHover
          styles={{
            th: {
              fontSize: 12,
              fontWeight: 600,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              borderBottom: "1px solid var(--mantine-color-default-border)",
              padding: "10px 16px",
            },
            td: {
              padding: "10px 16px",
              borderBottom: "1px solid var(--mantine-color-default-border)",
            },
          }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={36}>
                <Checkbox
                  size="xs"
                  checked={selected.length === filtered.length}
                  onChange={() =>
                    setSelected(
                      selected.length === filtered.length
                        ? []
                        : filtered.map((u) => u.id),
                    )
                  }
                />
              </Table.Th>
              <Table.Th>User</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Last Login</Table.Th>
              <Table.Th ta="right">Posts</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filtered.map((user) => (
              <Table.Tr key={user.id}>
                <Table.Td>
                  <Checkbox
                    size="xs"
                    checked={selected.includes(user.id)}
                    onChange={() => toggleSelect(user.id)}
                  />
                </Table.Td>
                <Table.Td>
                  <Anchor
                    component={Link}
                    href={`/users/${user.id}`}
                    underline="never"
                    c="inherit"
                  >
                    <Group gap="sm">
                      <Avatar
                        size="sm"
                        radius="xl"
                        color={roleColor[user.role]}
                      >
                        {user.avatar}
                      </Avatar>
                      <div>
                        <Text size="sm" fw={500}>
                          {user.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {user.email}
                        </Text>
                      </div>
                    </Group>
                  </Anchor>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={roleColor[user.role]} size="sm">
                    {user.role}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Badge
                    variant="dot"
                    color={statusColor[user.status]}
                    size="sm"
                  >
                    {user.status}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {user.lastLogin}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  <Text size="sm">{user.posts > 0 ? user.posts : "--"}</Text>
                </Table.Td>
                <Table.Td>
                  <Menu shadow="md" width={180} position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="gray" size="sm">
                        <IconDotsVertical size={14} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<IconEdit size={14} />}
                        onClick={() => {
                          notifications.show({
                            title: "Edit User",
                            message: `Opening editor for ${user.name}...`,
                            color: "blue",
                          });
                        }}
                      >
                        Edit
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconEye size={14} />}
                        component={Link}
                        href={`/users/${user.id}`}
                      >
                        View Profile
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconShield size={14} />}
                        onClick={() => {
                          notifications.show({
                            title: "Change Role",
                            message: `Role updated for ${user.name}.`,
                            color: "green",
                          });
                        }}
                      >
                        Change Role
                      </Menu.Item>
                      <Menu.Divider />
                      {user.status === "active" ? (
                        <Menu.Item
                          leftSection={<IconUserOff size={14} />}
                          color="orange"
                          onClick={() =>
                            modals.openConfirmModal({
                              title: "Suspend user",
                              children: (
                                <Text size="sm">
                                  Are you sure you want to suspend &ldquo;
                                  {user.name}&rdquo;? They will lose access to
                                  the dashboard.
                                </Text>
                              ),
                              labels: { confirm: "Suspend", cancel: "Cancel" },
                              confirmProps: { color: "orange" },
                              onConfirm: () =>
                                notifications.show({
                                  title: "User Suspended",
                                  message: `${user.name} has been suspended.`,
                                  color: "orange",
                                }),
                            })
                          }
                        >
                          Suspend
                        </Menu.Item>
                      ) : (
                        <Menu.Item
                          leftSection={<IconBan size={14} />}
                          color="orange"
                          onClick={() => {
                            notifications.show({
                              title: "User Disabled",
                              message: `${user.name} has been disabled.`,
                              color: "orange",
                            });
                          }}
                        >
                          Disable
                        </Menu.Item>
                      )}
                      <Menu.Item
                        leftSection={<IconTrash size={14} />}
                        color="red"
                        onClick={() =>
                          modals.openConfirmModal({
                            title: "Delete user",
                            children: (
                              <Text size="sm">
                                Are you sure you want to delete &ldquo;
                                {user.name}&rdquo;? This action cannot be
                                undone.
                              </Text>
                            ),
                            labels: { confirm: "Delete", cancel: "Cancel" },
                            confirmProps: { color: "red" },
                            onConfirm: () =>
                              notifications.show({
                                title: "Deleted",
                                message: `${user.name} has been deleted.`,
                                color: "red",
                              }),
                          })
                        }
                      >
                        Delete
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Box>

      <Group justify="space-between" mt="md">
        <Text size="xs" c="dimmed">
          Showing {filtered.length} of {users.length} users
        </Text>
        <Pagination total={3} size="xs" />
      </Group>
    </Box>
  );
};

export default Users;
