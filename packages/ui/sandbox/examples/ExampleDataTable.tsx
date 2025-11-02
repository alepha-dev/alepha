import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconEdit, IconEye, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import DataTable, {
  type DataTableColumn,
} from "../../src/components/table/DataTable.tsx";

// Sample data type
interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  status: "active" | "inactive" | "pending";
  joinDate: string;
  avatar: string;
}

// Generate sample data
const users: User[] = [
  {
    id: 1,
    name: "John Doe",
    email: "john@example.com",
    role: "Admin",
    status: "active",
    joinDate: "2024-01-15",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=1",
  },
  {
    id: 2,
    name: "Jane Smith",
    email: "jane@example.com",
    role: "User",
    status: "active",
    joinDate: "2024-02-20",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=2",
  },
  {
    id: 3,
    name: "Bob Johnson",
    email: "bob@example.com",
    role: "Manager",
    status: "inactive",
    joinDate: "2024-03-10",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=3",
  },
  {
    id: 4,
    name: "Alice Brown",
    email: "alice@example.com",
    role: "Developer",
    status: "active",
    joinDate: "2024-01-25",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=4",
  },
  {
    id: 5,
    name: "Charlie Wilson",
    email: "charlie@example.com",
    role: "Designer",
    status: "pending",
    joinDate: "2024-04-05",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=5",
  },
  {
    id: 6,
    name: "Eva Davis",
    email: "eva@example.com",
    role: "User",
    status: "active",
    joinDate: "2024-02-15",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=6",
  },
  {
    id: 7,
    name: "Frank Miller",
    email: "frank@example.com",
    role: "Developer",
    status: "active",
    joinDate: "2024-03-20",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=7",
  },
  {
    id: 8,
    name: "Grace Lee",
    email: "grace@example.com",
    role: "Manager",
    status: "inactive",
    joinDate: "2024-01-05",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=8",
  },
];

export default function ExampleDataTable() {
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);

  // Column definitions
  const columns: DataTableColumn<User>[] = [
    {
      accessor: "id",
      title: "ID",
      width: 60,
      sortable: true,
    },
    {
      accessor: "name",
      title: "User",
      sortable: true,
      render: (_, user) => (
        <Group gap="sm">
          <Avatar src={user.avatar} size="sm" radius="xl" />
          <div>
            <Text size="sm" fw={500}>
              {user.name}
            </Text>
            <Text size="xs" c="dimmed">
              {user.email}
            </Text>
          </div>
        </Group>
      ),
    },
    {
      accessor: "role",
      title: "Role",
      sortable: true,
      render: (role) => (
        <Badge variant="light" color="blue">
          {role}
        </Badge>
      ),
    },
    {
      accessor: "status",
      title: "Status",
      sortable: true,
      render: (status) => {
        const colors = { active: "green", inactive: "red", pending: "yellow" };
        return (
          <Badge variant="dot" color={colors[status as keyof typeof colors]}>
            {status}
          </Badge>
        );
      },
    },
    {
      accessor: "joinDate",
      title: "Join Date",
      sortable: true,
      render: (date) => new Date(date).toLocaleDateString(),
    },
  ];

  // Row actions
  const rowActions = (user: User) => (
    <Group gap="xs" justify="center">
      <ActionIcon
        variant="subtle"
        size="sm"
        onClick={() => console.log("View", user)}
      >
        <IconEye size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        size="sm"
        onClick={() => console.log("Edit", user)}
      >
        <IconEdit size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="red"
        size="sm"
        onClick={() => console.log("Delete", user)}
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  );

  return (
    <Stack gap="xl" p="md">
      <div>
        <Title order={1} mb="md">
          DataTable Example
        </Title>
        <Text c="dimmed">
          A comprehensive data table component with sorting, pagination,
          selection, and search.
        </Text>
      </div>

      <Paper shadow="sm" p="md" withBorder>
        <DataTable
          data={users}
          columns={columns}
          title="User Management"
          actions={
            <Button leftSection={<IconPlus size={16} />} size="sm">
              Add User
            </Button>
          }
          selectable
          selectedRows={selectedUsers}
          onRowSelect={setSelectedUsers}
          sortable
          filterable
          paginate
          pageSize={5}
          rowActions={rowActions}
          showColumnToggle
          showRefresh
          onRefresh={() => console.log("Refreshing...")}
          showExport
          onExport={() => console.log("Exporting...")}
          striped
          highlightOnHover
        />
      </Paper>
    </Stack>
  );
}
