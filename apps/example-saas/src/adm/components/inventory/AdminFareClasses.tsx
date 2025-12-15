import { useAction, useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, DataTable, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Group,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCheck, IconReceipt, IconX } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import { useState } from "react";
import type { AdminInventoryController } from "../../../api/inventory/controllers/AdminInventoryController.ts";
import type { FareClass } from "../../../api/inventory/entities/fareClasses.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const AdminFareClasses = () => {
  const client = useClient<AdminInventoryController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Create form state
  const [createForm, setCreateForm] = useState({
    code: "",
    name: "",
    description: "",
    priceMultiplier: 1.0,
    isRefundable: false,
    isChangeable: false,
    refundFeePercent: 0,
    changeFeePercent: 0,
    minDaysBeforeDeparture: 0,
    sortOrder: 100,
  });

  const createAction = useAction(
    {
      handler: async () => {
        if (!createForm.code || !createForm.name) return;

        await client.createFareClass({
          body: {
            code: createForm.code.toUpperCase(),
            name: createForm.name,
            description: createForm.description,
            priceMultiplier: createForm.priceMultiplier,
            isRefundable: createForm.isRefundable,
            isChangeable: createForm.isChangeable,
            refundFeePercent: createForm.refundFeePercent,
            changeFeePercent: createForm.changeFeePercent,
            minDaysBeforeDeparture: createForm.minDaysBeforeDeparture,
            sortOrder: createForm.sortOrder,
          },
        });

        closeCreate();
        setCreateForm({
          code: "",
          name: "",
          description: "",
          priceMultiplier: 1.0,
          isRefundable: false,
          isChangeable: false,
          refundFeePercent: 0,
          changeFeePercent: 0,
          minDaysBeforeDeparture: 0,
          sortOrder: 100,
        });
        setRefreshKey((k) => k + 1);
      },
    },
    [createForm],
  );

  const filters = t.object({
    query: t.optional(t.text()),
    active: t.optional(t.boolean()),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<FareClass, typeof filters>
        key={refreshKey}
        submitOnInit
        actions={[
          {
            icon: IconReceipt,
            onClick: openCreate,
            label: "Create Fare Class",
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
        items={async (filters) => {
          const response = await client.findFareClasses({
            query: filters,
          });
          return response as Page<FareClass>;
        }}
        columns={{
          code: {
            label: "Code",
            fit: true,
            value: (item) => (
              <Text size="sm" fw={600} ff="monospace">
                {item.code}
              </Text>
            ),
          },
          name: {
            label: "Name",
            value: (item) => (
              <Stack gap={2}>
                <Text size="sm" fw={500}>
                  {item.name}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {item.description}
                </Text>
              </Stack>
            ),
          },
          priceMultiplier: {
            label: "Price Mult.",
            fit: true,
            value: (item) => (
              <Badge
                variant="light"
                color={
                  item.priceMultiplier < 1
                    ? "green"
                    : item.priceMultiplier > 1
                      ? "red"
                      : "gray"
                }
                size="sm"
              >
                {item.priceMultiplier.toFixed(2)}x
              </Badge>
            ),
          },
          refundable: {
            label: "Refundable",
            fit: true,
            value: (item) => (
              <Group gap="xs">
                {item.isRefundable ? (
                  <IconCheck size={16} color="var(--mantine-color-green-6)" />
                ) : (
                  <IconX size={16} color="var(--mantine-color-red-6)" />
                )}
                {item.isRefundable && item.refundFeePercent > 0 && (
                  <Text size="xs" c="dimmed">
                    ({item.refundFeePercent}% fee)
                  </Text>
                )}
              </Group>
            ),
          },
          changeable: {
            label: "Changeable",
            fit: true,
            value: (item) => (
              <Group gap="xs">
                {item.isChangeable ? (
                  <IconCheck size={16} color="var(--mantine-color-green-6)" />
                ) : (
                  <IconX size={16} color="var(--mantine-color-red-6)" />
                )}
                {item.isChangeable && item.changeFeePercent > 0 && (
                  <Text size="xs" c="dimmed">
                    ({item.changeFeePercent}% fee)
                  </Text>
                )}
              </Group>
            ),
          },
          minDays: {
            label: "Min Days",
            fit: true,
            value: (item) => (
              <Text size="sm">
                {item.minDaysBeforeDeparture > 0
                  ? `${item.minDaysBeforeDeparture}d`
                  : "Any"}
              </Text>
            ),
          },
          sortOrder: {
            label: "Order",
            fit: true,
            value: (item) => (
              <Text size="sm" c="dimmed">
                {item.sortOrder}
              </Text>
            ),
          },
          active: {
            label: "Active",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={item.active ? "green" : "gray"}
              >
                {item.active ? "Active" : "Inactive"}
              </Badge>
            ),
          },
        }}
      />

      {/* Create Fare Class Modal */}
      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title="Create Fare Class"
        size="lg"
      >
        <Stack gap="md">
          <Group grow>
            <TextInput
              label="Code"
              placeholder="FLEX"
              required
              value={createForm.code}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  code: e.currentTarget.value.toUpperCase(),
                })
              }
            />
            <TextInput
              label="Name"
              placeholder="Flexible"
              required
              value={createForm.name}
              onChange={(e) =>
                setCreateForm({ ...createForm, name: e.currentTarget.value })
              }
            />
          </Group>

          <Textarea
            label="Description"
            placeholder="Full flexibility with free changes and refunds"
            required
            value={createForm.description}
            onChange={(e) =>
              setCreateForm({
                ...createForm,
                description: e.currentTarget.value,
              })
            }
          />

          <Group grow>
            <NumberInput
              label="Price Multiplier"
              description="1.0 = base price, 0.7 = 30% off, 1.4 = 40% more"
              required
              min={0.1}
              max={5}
              step={0.1}
              decimalScale={2}
              value={createForm.priceMultiplier}
              onChange={(v) =>
                setCreateForm({ ...createForm, priceMultiplier: Number(v) })
              }
            />
            <NumberInput
              label="Min Days Before Departure"
              description="0 = available anytime"
              min={0}
              value={createForm.minDaysBeforeDeparture}
              onChange={(v) =>
                setCreateForm({
                  ...createForm,
                  minDaysBeforeDeparture: Number(v),
                })
              }
            />
          </Group>

          <Group grow>
            <Stack gap="xs">
              <Switch
                label="Refundable"
                checked={createForm.isRefundable}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    isRefundable: e.currentTarget.checked,
                  })
                }
              />
              {createForm.isRefundable && (
                <NumberInput
                  label="Refund Fee %"
                  min={0}
                  max={100}
                  value={createForm.refundFeePercent}
                  onChange={(v) =>
                    setCreateForm({
                      ...createForm,
                      refundFeePercent: Number(v),
                    })
                  }
                />
              )}
            </Stack>

            <Stack gap="xs">
              <Switch
                label="Changeable"
                checked={createForm.isChangeable}
                onChange={(e) =>
                  setCreateForm({
                    ...createForm,
                    isChangeable: e.currentTarget.checked,
                  })
                }
              />
              {createForm.isChangeable && (
                <NumberInput
                  label="Change Fee %"
                  min={0}
                  max={100}
                  value={createForm.changeFeePercent}
                  onChange={(v) =>
                    setCreateForm({
                      ...createForm,
                      changeFeePercent: Number(v),
                    })
                  }
                />
              )}
            </Stack>
          </Group>

          <NumberInput
            label="Sort Order"
            description="Lower values appear first"
            min={0}
            value={createForm.sortOrder}
            onChange={(v) =>
              setCreateForm({ ...createForm, sortOrder: Number(v) })
            }
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
              disabled={
                !createForm.code || !createForm.name || !createForm.description
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

export default AdminFareClasses;
