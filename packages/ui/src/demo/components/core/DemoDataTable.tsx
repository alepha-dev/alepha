import { DataTable, Text, useDialog } from "@alepha/ui";
import { Badge, Code, Flex, Paper } from "@mantine/core";
import {
  IconDownload,
  IconEdit,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

interface User {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user" | "guest";
  status: "active" | "inactive";
  notes?: string;
}

const sampleUsers: User[] = [
  {
    id: 1,
    name: "Alice Johnson",
    email: "alice@example.com",
    role: "admin",
    status: "active",
    notes: "Team lead for the backend team.",
  },
  {
    id: 2,
    name: "Bob Smith",
    email: "bob@example.com",
    role: "user",
    status: "active",
  },
  {
    id: 3,
    name: "Charlie Brown",
    email: "charlie@example.com",
    role: "user",
    status: "inactive",
    notes: "On leave until March.",
  },
  {
    id: 4,
    name: "Diana Prince",
    email: "diana@example.com",
    role: "admin",
    status: "active",
  },
  {
    id: 5,
    name: "Eve Wilson",
    email: "eve@example.com",
    role: "guest",
    status: "active",
    notes: "External consultant, limited access.",
  },
  {
    id: 6,
    name: "Frank Castle",
    email: "frank@example.com",
    role: "user",
    status: "inactive",
  },
  {
    id: 7,
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "admin",
    status: "active",
    notes: "Pioneered compiler development.",
  },
  {
    id: 8,
    name: "Hank Pym",
    email: "hank@example.com",
    role: "user",
    status: "active",
  },
];

const filters = t.object({
  search: t.optional(t.text({ title: "Search" })),
  role: t.optional(t.enum(["admin", "user", "guest"], { title: "Role" })),
  status: t.optional(t.enum(["active", "inactive"], { title: "Status" })),
});

const showcaseSchema = t.object({
  withCheckbox: t.boolean({
    title: "Checkbox",
    default: true,
    $control: { switch: true },
  }),
  withExport: t.boolean({
    title: "Export",
    default: true,
    $control: { switch: true },
  }),
  withPanel: t.boolean({
    title: "Panel",
    default: true,
    $control: { switch: true },
  }),
  withDrawer: t.boolean({
    title: "Drawer",
    default: true,
    $control: { switch: true },
  }),
  defaultSize: t.integer({
    title: "Page Size",
    default: 5,
    minimum: 1,
    maximum: 20,
    $control: { slider: true },
  }),
});

interface DataTablePreviewProps {
  withCheckbox: boolean;
  withExport: boolean;
  withPanel: boolean;
  withDrawer: boolean;
  defaultSize: number;
}

const DataTablePreview = (props: DataTablePreviewProps) => {
  const dialog = useDialog();

  return (
    <DataTable<User, typeof filters>
      key={JSON.stringify(props)}
      filters={filters}
      defaultFilters={["search", "role"]}
      submitOnInit
      defaultSize={props.defaultSize}
      withCheckbox={props.withCheckbox}
      withExport={props.withExport}
      getItemKey={(u) => String(u.id)}
      onFilterChange={(key, _value, form) => {
        if (key === "role" || key === "status") {
          return form.submit();
        }
      }}
      typeFormProps={{
        skipSubmitButton: true,
        columns: 3,
      }}
      items={async (params) => {
        let filtered = [...sampleUsers];
        if (params.search) {
          const s = params.search.toLowerCase();
          filtered = filtered.filter(
            (u) =>
              u.name.toLowerCase().includes(s) ||
              u.email.toLowerCase().includes(s),
          );
        }
        if (params.role) {
          filtered = filtered.filter((u) => u.role === params.role);
        }
        if (params.status) {
          filtered = filtered.filter((u) => u.status === params.status);
        }
        const start = params.page * params.size;
        const content = filtered.slice(start, start + params.size);
        return {
          content,
          page: {
            totalElements: filtered.length,
            totalPages: Math.ceil(filtered.length / params.size),
          },
        };
      }}
      actions={[
        {
          tooltip: "Add User",
          icon: IconPlus,
          variant: "light",
          size: "xs",
          onClick: () => dialog.alert({ message: "Add user clicked" }),
        },
      ]}
      checkboxActions={[
        {
          label: "Export Selected",
          icon: <IconDownload size={14} />,
          intent: "primary",
          onClick: ({ selectedItems, clearSelection }) => {
            dialog.alert({
              message: `Exporting ${selectedItems.length} users`,
            });
            clearSelection();
          },
        },
        {
          label: "Delete Selected",
          icon: <IconTrash size={14} />,
          intent: "danger",
          onClick: ({ selectedItems, clearSelection }) => {
            dialog.alert({
              message: `Deleting ${selectedItems.length} users`,
            });
            clearSelection();
          },
        },
      ]}
      columns={{
        id: {
          label: "ID",
          value: (u) => <Text size="sm">{u.id}</Text>,
          sortable: true,
          fit: true,
        },
        name: {
          label: "Name",
          value: (u) => (
            <Text size="sm" fw={500}>
              {u.name}
            </Text>
          ),
          sortable: true,
        },
        email: {
          label: "Email",
          value: (u) => (
            <Text size="sm" c="dimmed">
              {u.email}
            </Text>
          ),
        },
        role: {
          label: "Role",
          value: (u) => (
            <Badge
              size="sm"
              color={
                u.role === "admin"
                  ? "blue"
                  : u.role === "user"
                    ? "green"
                    : "gray"
              }
            >
              {u.role}
            </Badge>
          ),
        },
        status: {
          label: "Status",
          value: (u) => (
            <Badge
              size="sm"
              color={u.status === "active" ? "green" : "red"}
              variant="light"
            >
              {u.status}
            </Badge>
          ),
        },
        notes: {
          label: "Notes",
          defaultHidden: true,
          value: (u) => (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {u.notes ?? "—"}
            </Text>
          ),
        },
      }}
      rowActions={(u) => [
        {
          label: "Edit",
          icon: IconEdit,
          color: "blue",
          onClick: () => dialog.alert({ message: `Edit ${u.name}` }),
        },
        {
          label: "Delete",
          icon: IconTrash,
          color: "red",
          onClick: () => dialog.alert({ message: `Delete ${u.name}` }),
          visible: u.role !== "admin",
        },
      ]}
      panel={
        props.withPanel
          ? {
              can: (u) => Boolean(u.notes),
              render: (u) => (
                <Flex direction="column" gap="xs" p="sm">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                    Notes
                  </Text>
                  <Text size="sm">{u.notes}</Text>
                </Flex>
              ),
            }
          : undefined
      }
      drawer={
        props.withDrawer
          ? (u) => (
              <Flex direction="column" gap="md">
                <Text size="lg" fw={600}>
                  {u.name}
                </Text>
                <Paper p="sm" radius="md" withBorder>
                  <Flex direction="column" gap="xs">
                    <Flex gap="xs">
                      <Text size="sm" c="dimmed" w={60}>
                        Email
                      </Text>
                      <Text size="sm">{u.email}</Text>
                    </Flex>
                    <Flex gap="xs">
                      <Text size="sm" c="dimmed" w={60}>
                        Role
                      </Text>
                      <Badge
                        size="sm"
                        color={
                          u.role === "admin"
                            ? "blue"
                            : u.role === "user"
                              ? "green"
                              : "gray"
                        }
                      >
                        {u.role}
                      </Badge>
                    </Flex>
                    <Flex gap="xs">
                      <Text size="sm" c="dimmed" w={60}>
                        Status
                      </Text>
                      <Badge
                        size="sm"
                        color={u.status === "active" ? "green" : "red"}
                        variant="light"
                      >
                        {u.status}
                      </Badge>
                    </Flex>
                  </Flex>
                </Paper>
                {u.notes && (
                  <Paper p="sm" radius="md" withBorder>
                    <Text size="sm" fw={600} mb="xs">
                      Notes
                    </Text>
                    <Text size="sm">{u.notes}</Text>
                  </Paper>
                )}
                <Paper p="sm" radius="md" withBorder>
                  <Text size="sm" fw={600} mb="xs">
                    Raw Data
                  </Text>
                  <Code block>{JSON.stringify(u, null, 2)}</Code>
                </Paper>
              </Flex>
            )
          : undefined
      }
      tableProps={{
        highlightOnHover: true,
      }}
    />
  );
};

const DemoDataTable = () => {
  return (
    <Showcase
      title="DataTable"
      schema={showcaseSchema}
      initialValues={{
        withCheckbox: true,
        withExport: true,
        withPanel: true,
        withDrawer: true,
        defaultSize: 5,
      }}
      columns={1}
    >
      {(props) => <DataTablePreview {...(props as DataTablePreviewProps)} />}
    </Showcase>
  );
};

export default DemoDataTable;
