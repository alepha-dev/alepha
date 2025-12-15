import { useAction, useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconStar, IconUserPlus } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import { useState } from "react";
import type { CustomerController } from "../../../api/customers/controllers/CustomerController.ts";
import type { Customer } from "../../../api/customers/entities/customers.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const tierColors: Record<string, string> = {
  bronze: "orange",
  silver: "gray",
  gold: "yellow",
  platinum: "violet",
};

const AdminCustomers = () => {
  const client = useClient<CustomerController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Create form state
  const [createForm, setCreateForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    gender: "" as "" | "male" | "female" | "other" | "prefer_not_to_say",
  });

  const createAction = useAction(
    {
      handler: async () => {
        if (!createForm.email) return;

        await client.createCustomer({
          body: {
            email: createForm.email,
            firstName: createForm.firstName || undefined,
            lastName: createForm.lastName || undefined,
            phone: createForm.phone || undefined,
            gender: createForm.gender || undefined,
          },
        });

        closeCreate();
        setCreateForm({
          email: "",
          firstName: "",
          lastName: "",
          phone: "",
          gender: "",
        });
        setRefreshKey((k) => k + 1);
      },
    },
    [createForm],
  );

  const filters = t.object({
    query: t.optional(t.text()),
    loyaltyTier: t.optional(t.enum(["bronze", "silver", "gold", "platinum"])),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<Customer, typeof filters>
        key={refreshKey}
        submitOnInit
        actions={[
          {
            icon: IconUserPlus,
            onClick: openCreate,
            label: "Create Customer",
          },
        ]}
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 2,
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
            router.go("adminCustomerDetails", {
              params: { customerId: item.id },
            }),
        })}
        items={async (filters) => {
          const response = await client.findCustomers({
            query: filters,
          });
          return response as Page<Customer>;
        }}
        columns={{
          name: {
            label: "Customer",
            value: (item) => (
              <Stack gap={2}>
                <Text size="sm" fw={500}>
                  {item.firstName || item.lastName
                    ? `${item.firstName || ""} ${item.lastName || ""}`.trim()
                    : "—"}
                </Text>
                {item.phone && (
                  <Text size="xs" c="dimmed">
                    {item.phone}
                  </Text>
                )}
              </Stack>
            ),
          },
          loyaltyTier: {
            label: "Loyalty Tier",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={tierColors[item.loyaltyTier] || "gray"}
                leftSection={<IconStar size={12} />}
              >
                {item.loyaltyTier.charAt(0).toUpperCase() +
                  item.loyaltyTier.slice(1)}
              </Badge>
            ),
          },
          loyaltyPoints: {
            label: "Points",
            fit: true,
            value: (item) => (
              <Text size="sm" fw={500} ff="monospace">
                {item.loyaltyPoints.toLocaleString()}
              </Text>
            ),
          },
          totalBookings: {
            label: "Bookings",
            fit: true,
            value: (item) => (
              <Text size="sm" c="dimmed">
                {item.totalBookings}
              </Text>
            ),
          },
          totalSpent: {
            label: "Total Spent",
            fit: true,
            value: (item) => (
              <Text size="sm" fw={500}>
                €{item.totalSpent.toFixed(2)}
              </Text>
            ),
          },
          createdAt: {
            label: "Joined",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
        }}
      />

      {/* Create Customer Modal */}
      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title="Create Customer"
      >
        <Stack gap="md">
          <TextInput
            label="Email"
            placeholder="john@example.com"
            required
            type="email"
            value={createForm.email}
            onChange={(e) =>
              setCreateForm({ ...createForm, email: e.currentTarget.value })
            }
          />

          <Group grow>
            <TextInput
              label="First Name"
              placeholder="John"
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
              value={createForm.lastName}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  lastName: e.currentTarget.value,
                })
              }
            />
          </Group>

          <TextInput
            label="Phone"
            placeholder="+33 1 23 45 67 89"
            value={createForm.phone}
            onChange={(e) =>
              setCreateForm({ ...createForm, phone: e.currentTarget.value })
            }
          />

          <Select
            label="Gender"
            placeholder="Select gender"
            data={[
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
              { value: "other", label: "Other" },
              { value: "prefer_not_to_say", label: "Prefer not to say" },
            ]}
            value={createForm.gender}
            onChange={(v) =>
              setCreateForm({
                ...createForm,
                gender:
                  (v as "male" | "female" | "other" | "prefer_not_to_say") ||
                  "",
              })
            }
            clearable
          />

          <Group justify="flex-end" mt="md">
            <ActionButton variant="subtle" onClick={closeCreate}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="filled"
              color="pink"
              onClick={createAction.run}
              loading={createAction.loading}
              disabled={!createForm.email}
            >
              Create
            </ActionButton>
          </Group>
        </Stack>
      </Modal>
    </Flex>
  );
};

export default AdminCustomers;
