import { DataTable } from "@alepha/ui";
import { Badge, Text } from "@mantine/core";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

interface User {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user" | "guest";
  status: "active" | "inactive";
}

const sampleUsers: User[] = [
  {
    id: 1,
    name: "Alice Johnson",
    email: "alice@example.com",
    role: "admin",
    status: "active",
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
  },
];

const filters = t.object({
  search: t.optional(t.text({ title: "Search" })),
  role: t.optional(t.enum(["admin", "user", "guest"], { title: "Role" })),
});

const showcaseSchema = t.object({
  withCheckbox: t.boolean({
    title: "Checkbox",
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

const DemoDataTable = () => {
  return (
    <Showcase
      title="DataTable"
      schema={showcaseSchema}
      initialValues={{
        withCheckbox: true,
        defaultSize: 5,
      }}
      columns={1}
    >
      {(props) => (
        <DataTable<User, typeof filters>
          key={`${props.withCheckbox}-${props.defaultSize}`}
          filters={filters}
          submitOnInit
          defaultSize={props.defaultSize}
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
          }}
          withCheckbox={props.withCheckbox}
          getItemKey={(u) => String(u.id)}
        />
      )}
    </Showcase>
  );
};

export default DemoDataTable;
