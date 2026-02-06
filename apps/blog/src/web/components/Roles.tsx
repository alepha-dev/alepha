import {
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconEdit, IconPlus, IconShield, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

interface Role {
  name: string;
  description: string;
  userCount: number;
  color: string;
  permissions: string[];
}

const allPermissions = [
  "Manage Users",
  "Edit Posts",
  "Edit Others' Posts",
  "Publish Posts",
  "Delete Posts",
  "Upload Media",
  "Moderate Comments",
  "Manage Settings",
  "Manage Themes",
  "View Analytics",
];

const initialRoles: Role[] = [
  {
    name: "Administrator",
    description:
      "Full access to all settings, content, and user management. Administrators can perform any action on the site.",
    userCount: 3,
    color: "red",
    permissions: [...allPermissions],
  },
  {
    name: "Editor",
    description:
      "Can publish and manage posts including the posts of other users. Editors can also moderate comments and manage media.",
    userCount: 5,
    color: "blue",
    permissions: [
      "Edit Posts",
      "Edit Others' Posts",
      "Publish Posts",
      "Delete Posts",
      "Upload Media",
      "Moderate Comments",
      "View Analytics",
    ],
  },
  {
    name: "Author",
    description:
      "Can publish and manage their own posts. Authors have the ability to upload media and view site analytics.",
    userCount: 8,
    color: "teal",
    permissions: [
      "Edit Posts",
      "Publish Posts",
      "Upload Media",
      "View Analytics",
    ],
  },
  {
    name: "Contributor",
    description:
      "Can write and manage their own posts but cannot publish them. Posts must be reviewed by an editor before going live.",
    userCount: 12,
    color: "orange",
    permissions: ["Edit Posts", "View Analytics"],
  },
  {
    name: "Subscriber",
    description:
      "Can only manage their profile and view published content. Subscribers have read-only access to the site.",
    userCount: 45,
    color: "gray",
    permissions: ["View Analytics"],
  },
];

const permissionBadgeColor: Record<string, string> = {
  "Manage Users": "red",
  "Edit Posts": "blue",
  "Edit Others' Posts": "indigo",
  "Publish Posts": "teal",
  "Delete Posts": "pink",
  "Upload Media": "green",
  "Moderate Comments": "orange",
  "Manage Settings": "grape",
  "Manage Themes": "violet",
  "View Analytics": "cyan",
};

const Roles = () => {
  const [roles, setRoles] = useState<Role[]>(initialRoles);

  const handleDelete = (roleName: string) => {
    modals.openConfirmModal({
      title: "Delete Role",
      children: (
        <Text size="sm">
          Are you sure you want to delete the{" "}
          <Text span fw={600}>
            {roleName}
          </Text>{" "}
          role? Users assigned to this role will be moved to the default
          Subscriber role. This action cannot be undone.
        </Text>
      ),
      labels: { confirm: "Delete Role", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => {
        setRoles((prev) => prev.filter((r) => r.name !== roleName));
        notifications.show({
          title: "Role Deleted",
          message: `The "${roleName}" role has been successfully deleted.`,
          color: "red",
        });
      },
    });
  };

  const handleEdit = (roleName: string) => {
    notifications.show({
      title: "Edit Role",
      message: `Opening editor for "${roleName}" role.`,
      color: "blue",
    });
  };

  const handleAddRole = () => {
    notifications.show({
      title: "Add Role",
      message: "Role creation dialog would open here.",
      color: "orange",
    });
  };

  return (
    <Box>
      {/* Page header */}
      <Group justify="space-between" align="center" mb="xl">
        <Group gap="sm">
          <IconShield size={28} color="#f6821f" />
          <Title order={2} fw={600}>
            Roles & Permissions
          </Title>
        </Group>
        <Button
          leftSection={<IconPlus size={14} />}
          color="orange"
          size="sm"
          onClick={handleAddRole}
        >
          Add Role
        </Button>
      </Group>

      {/* Roles Grid */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" mb="xl">
        {roles.map((role) => (
          <Card key={role.name} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600} size="lg">
                  {role.name}
                </Text>
                <Badge variant="light" color={role.color} size="sm">
                  {role.userCount} {role.userCount === 1 ? "user" : "users"}
                </Badge>
              </Group>

              <Text size="sm" c="dimmed" lineClamp={2}>
                {role.description}
              </Text>

              <Box>
                <Text size="xs" fw={500} c="dimmed" mb={6}>
                  Permissions
                </Text>
                <Group gap={6}>
                  {role.permissions.map((perm) => (
                    <Badge
                      key={perm}
                      variant="dot"
                      color={permissionBadgeColor[perm] ?? "gray"}
                      size="xs"
                    >
                      {perm}
                    </Badge>
                  ))}
                </Group>
              </Box>

              <Group justify="flex-end" gap="xs" mt="xs">
                <Button
                  variant="light"
                  color="blue"
                  size="xs"
                  leftSection={<IconEdit size={14} />}
                  onClick={() => handleEdit(role.name)}
                >
                  Edit
                </Button>
                <Button
                  variant="light"
                  color="red"
                  size="xs"
                  leftSection={<IconTrash size={14} />}
                  disabled={role.name === "Administrator"}
                  onClick={() => handleDelete(role.name)}
                >
                  Delete
                </Button>
              </Group>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>

      {/* Permissions Matrix */}
      <Card withBorder radius="md" p={0}>
        <Group p="md" pb="xs">
          <Text fw={600} size="sm">
            Permissions Matrix
          </Text>
        </Group>
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
              padding: "8px 16px",
            },
            td: {
              padding: "10px 16px",
              borderBottom: "1px solid var(--mantine-color-default-border)",
            },
          }}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Permission</Table.Th>
              {roles.map((role) => (
                <Table.Th key={role.name} ta="center">
                  {role.name}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {allPermissions.map((perm) => (
              <Table.Tr key={perm}>
                <Table.Td>
                  <Group gap="xs">
                    <Badge
                      variant="dot"
                      color={permissionBadgeColor[perm] ?? "gray"}
                      size="xs"
                    >
                      {perm}
                    </Badge>
                  </Group>
                </Table.Td>
                {roles.map((role) => (
                  <Table.Td key={role.name} ta="center">
                    <Checkbox
                      checked={role.permissions.includes(perm)}
                      readOnly
                      size="xs"
                      color={role.color}
                      styles={{
                        input: { cursor: "default" },
                        root: {
                          display: "flex",
                          justifyContent: "center",
                        },
                      }}
                    />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Box>
  );
};

export default Roles;
