import { useAction, useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, DataTable, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconUserPlus } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import { useState } from "react";
import type { AgentController } from "../../../api/agents/controllers/AgentController.ts";
import type { AgentProfile } from "../../../api/agents/entities/agentProfiles.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const statusColors: Record<string, string> = {
  active: "green",
  inactive: "gray",
  suspended: "red",
};

const AdminAgents = () => {
  const client = useClient<AgentController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [createForm, setCreateForm] = useState({
    email: "",
    username: "",
    firstName: "",
    lastName: "",
    password: "",
    role: "" as "" | "admin" | "supervisor" | "support" | "operations",
    employeeId: "",
    department: "",
    jobTitle: "",
  });

  const createAction = useAction(
    {
      handler: async () => {
        if (!createForm.email || !createForm.username || !createForm.password)
          return;

        await client.createAgent({
          body: {
            email: createForm.email,
            username: createForm.username,
            firstName: createForm.firstName,
            lastName: createForm.lastName,
            password: createForm.password,
            role: createForm.role || undefined,
            employeeId: createForm.employeeId || undefined,
            department: createForm.department || undefined,
            jobTitle: createForm.jobTitle || undefined,
          },
        });

        closeCreate();
        setCreateForm({
          email: "",
          username: "",
          firstName: "",
          lastName: "",
          password: "",
          role: "",
          employeeId: "",
          department: "",
          jobTitle: "",
        });
        setRefreshKey((k) => k + 1);
      },
    },
    [createForm],
  );

  const filters = t.object({
    query: t.optional(t.text()),
    status: t.optional(t.enum(["active", "inactive", "suspended"])),
    department: t.optional(t.text()),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<AgentProfile, typeof filters>
        key={refreshKey}
        submitOnInit
        actions={[
          {
            icon: IconUserPlus,
            onClick: openCreate,
            label: "Create Agent",
          },
        ]}
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 3,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
          striped: false,
          highlightOnHover: true,
        }}
        onFilterChange={(key, value, form) => {
          return form.submit();
        }}
        filters={filters}
        tableTrProps={(item) => ({
          style: { cursor: "pointer" },
          onClick: () =>
            router.go("adminAgentDetails", {
              params: { agentId: item.id },
            }),
        })}
        items={async (filters) => {
          const response = await client.findAgents({
            query: filters,
          });
          return response as Page<AgentProfile>;
        }}
        columns={{
          employee: {
            label: "Employee",
            value: (item) => (
              <Stack gap={2}>
                <Text size="sm" fw={500}>
                  {item.employeeId || "—"}
                </Text>
                {item.jobTitle && (
                  <Text size="xs" c="dimmed">
                    {item.jobTitle}
                  </Text>
                )}
              </Stack>
            ),
          },
          contact: {
            label: "Contact",
            value: (item) => (
              <Stack gap={2}>
                <Text size="sm">{item.workEmail || "—"}</Text>
                {item.workPhone && (
                  <Text size="xs" c="dimmed">
                    {item.workPhone}
                  </Text>
                )}
              </Stack>
            ),
          },
          department: {
            label: "Department",
            fit: true,
            value: (item) => (
              <Text size="sm" c="dimmed">
                {item.department || "—"}
              </Text>
            ),
          },
          status: {
            label: "Status",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={statusColors[item.status] || "gray"}
              >
                {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
              </Badge>
            ),
          },
          hiredAt: {
            label: "Hired",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {item.hiredAt ? l(item.hiredAt, { date: "medium" }) : "—"}
              </Text>
            ),
          },
        }}
      />

      {/* Create Agent Modal */}
      <Modal opened={createOpened} onClose={closeCreate} title="Create Agent">
        <Stack gap="md">
          <Group grow>
            <TextInput
              label="Username"
              placeholder="jdoe"
              required
              value={createForm.username}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  username: e.currentTarget.value,
                })
              }
            />
            <TextInput
              label="Email"
              placeholder="john@company.com"
              required
              type="email"
              value={createForm.email}
              onChange={(e) =>
                setCreateForm({ ...createForm, email: e.currentTarget.value })
              }
            />
          </Group>

          <Group grow>
            <TextInput
              label="First Name"
              placeholder="John"
              required
              value={createForm.firstName}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  firstName: e.currentTarget.value,
                })
              }
            />
            <TextInput
              label="Last Name"
              placeholder="Doe"
              required
              value={createForm.lastName}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  lastName: e.currentTarget.value,
                })
              }
            />
          </Group>

          <PasswordInput
            label="Password"
            placeholder="Min. 8 characters"
            required
            value={createForm.password}
            onChange={(e) =>
              setCreateForm({ ...createForm, password: e.currentTarget.value })
            }
          />

          <Select
            label="Role"
            placeholder="Select role"
            data={[
              { value: "admin", label: "Admin" },
              { value: "supervisor", label: "Supervisor" },
              { value: "support", label: "Support" },
              { value: "operations", label: "Operations" },
            ]}
            value={createForm.role}
            onChange={(v) =>
              setCreateForm({
                ...createForm,
                role:
                  (v as "admin" | "supervisor" | "support" | "operations") ||
                  "",
              })
            }
            clearable
          />

          <Group grow>
            <TextInput
              label="Employee ID"
              placeholder="EMP-001"
              value={createForm.employeeId}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  employeeId: e.currentTarget.value,
                })
              }
            />
            <TextInput
              label="Department"
              placeholder="Operations"
              value={createForm.department}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  department: e.currentTarget.value,
                })
              }
            />
          </Group>

          <TextInput
            label="Job Title"
            placeholder="Support Agent"
            value={createForm.jobTitle}
            onChange={(e) =>
              setCreateForm({ ...createForm, jobTitle: e.currentTarget.value })
            }
          />

          <Group justify="flex-end" mt="md">
            <ActionButton variant="subtle" onClick={closeCreate}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="filled"
              color="blue"
              onClick={createAction.run}
              loading={createAction.loading}
              disabled={
                !createForm.email ||
                !createForm.username ||
                !createForm.password ||
                !createForm.firstName ||
                !createForm.lastName
              }
            >
              Create
            </ActionButton>
          </Group>
        </Stack>
      </Modal>
    </Flex>
  );
};

export default AdminAgents;
