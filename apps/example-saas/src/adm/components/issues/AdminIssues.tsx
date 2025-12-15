import { useAction, useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, DataTable, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Group,
  Modal,
  Select,
  Stack,
  TagsInput,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPlus } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import { useState } from "react";
import type { IssueController } from "../../../api/issues/controllers/IssueController.ts";
import type { Issue } from "../../../api/issues/entities/issues.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const statusColors: Record<string, string> = {
  open: "blue",
  pending: "yellow",
  accepted: "green",
  rejected: "red",
  cancelled: "gray",
  archived: "gray",
};

const priorityColors: Record<string, string> = {
  low: "gray",
  medium: "blue",
  high: "orange",
  urgent: "red",
};

const creatorTypeLabels: Record<string, string> = {
  system: "System",
  customer: "Customer",
  agent: "Agent",
};

const AdminIssues = () => {
  const client = useClient<IssueController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    creatorType: "agent" as "system" | "customer" | "agent",
    priority: "medium" as "low" | "medium" | "high" | "urgent",
    category: "",
    tags: [] as string[],
  });

  const createAction = useAction(
    {
      handler: async () => {
        if (!createForm.title) return;

        await client.createIssue({
          body: {
            title: createForm.title,
            description: createForm.description || undefined,
            creatorType: createForm.creatorType,
            priority: createForm.priority,
            category: createForm.category || undefined,
            tags: createForm.tags.length > 0 ? createForm.tags : undefined,
          },
        });

        closeCreate();
        setCreateForm({
          title: "",
          description: "",
          creatorType: "agent",
          priority: "medium",
          category: "",
          tags: [],
        });
        setRefreshKey((k) => k + 1);
      },
    },
    [createForm],
  );

  const filters = t.object({
    query: t.optional(t.text()),
    status: t.optional(
      t.enum([
        "open",
        "pending",
        "accepted",
        "rejected",
        "cancelled",
        "archived",
      ]),
    ),
    priority: t.optional(t.enum(["low", "medium", "high", "urgent"])),
    creatorType: t.optional(t.enum(["system", "customer", "agent"])),
    category: t.optional(t.text()),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<Issue, typeof filters>
        key={refreshKey}
        submitOnInit
        actions={[
          {
            icon: IconPlus,
            onClick: openCreate,
            label: "Create Issue",
          },
        ]}
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 5,
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
            router.go("adminIssueDetails", {
              params: { issueId: item.id },
            }),
        })}
        items={async (filters) => {
          const response = await client.findIssues({
            query: filters,
          });
          return response as Page<Issue>;
        }}
        columns={{
          title: {
            label: "Issue",
            sortable: true,
            value: (item) => (
              <Stack gap={2}>
                <Text size="sm" fw={500} lineClamp={1}>
                  {item.title}
                </Text>
                {item.category && (
                  <Text size="xs" c="dimmed">
                    {item.category}
                  </Text>
                )}
              </Stack>
            ),
          },
          status: {
            label: "Status",
            fit: true,
            sortable: true,
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
          priority: {
            label: "Priority",
            fit: true,
            sortable: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="outline"
                color={priorityColors[item.priority] || "gray"}
              >
                {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
              </Badge>
            ),
          },
          creatorType: {
            label: "Created By",
            fit: true,
            value: (item) => (
              <Text size="sm" c="dimmed">
                {creatorTypeLabels[item.creatorType] || item.creatorType}
              </Text>
            ),
          },
          createdAt: {
            label: "Created",
            fit: true,
            sortable: true,
            sortKey: "-createdAt",
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
        }}
      />

      {/* Create Issue Modal */}
      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title="Create Issue"
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Title"
            placeholder="Brief description of the issue"
            required
            value={createForm.title}
            onChange={(e) =>
              setCreateForm({
                ...createForm,
                title: e.currentTarget.value,
              })
            }
          />

          <Textarea
            label="Description"
            placeholder="Detailed description of the issue..."
            rows={4}
            value={createForm.description}
            onChange={(e) =>
              setCreateForm({
                ...createForm,
                description: e.currentTarget.value,
              })
            }
          />

          <Group grow>
            <Select
              label="Creator Type"
              data={[
                { value: "system", label: "System" },
                { value: "customer", label: "Customer" },
                { value: "agent", label: "Agent" },
              ]}
              value={createForm.creatorType}
              onChange={(v) =>
                setCreateForm({
                  ...createForm,
                  creatorType:
                    (v as "system" | "customer" | "agent") || "agent",
                })
              }
            />

            <Select
              label="Priority"
              data={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "urgent", label: "Urgent" },
              ]}
              value={createForm.priority}
              onChange={(v) =>
                setCreateForm({
                  ...createForm,
                  priority:
                    (v as "low" | "medium" | "high" | "urgent") || "medium",
                })
              }
            />
          </Group>

          <TextInput
            label="Category"
            placeholder="e.g., refund, complaint, inquiry"
            value={createForm.category}
            onChange={(e) =>
              setCreateForm({
                ...createForm,
                category: e.currentTarget.value,
              })
            }
          />

          <TagsInput
            label="Tags"
            placeholder="Press Enter to add tags"
            value={createForm.tags}
            onChange={(tags) =>
              setCreateForm({
                ...createForm,
                tags,
              })
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
              disabled={!createForm.title}
            >
              Create
            </ActionButton>
          </Group>
        </Stack>
      </Modal>
    </Flex>
  );
};

export default AdminIssues;
