import { useAction, useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, DataTable, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  TextInput,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { IconGift, IconPercentage } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import { useState } from "react";
import type { CustomerController } from "../../../api/customers/controllers/CustomerController.ts";
import type { Voucher } from "../../../api/customers/entities/vouchers.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const statusColors: Record<string, string> = {
  active: "green",
  used: "blue",
  expired: "gray",
  revoked: "red",
};

const typeLabels: Record<string, string> = {
  percentage: "% Off",
  fixed_amount: "Fixed",
  free_upgrade: "Upgrade",
  free_seat_selection: "Free Seat",
  points_multiplier: "Points",
};

type VoucherType =
  | "percentage"
  | "fixed_amount"
  | "free_upgrade"
  | "free_seat_selection"
  | "points_multiplier";

type VoucherSource =
  | "welcome"
  | "loyalty"
  | "promotion"
  | "compensation"
  | "referral"
  | "birthday"
  | "gift"
  | "partner";

const AdminVouchers = () => {
  const client = useClient<CustomerController>();
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
    type: "percentage" as VoucherType,
    value: 10,
    source: "promotion" as VoucherSource,
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    maxUses: 1,
    minPurchase: 0,
  });

  const createAction = useAction(
    {
      handler: async () => {
        if (!createForm.code || !createForm.name) return;

        await client.createVoucher({
          body: {
            code: createForm.code.toUpperCase(),
            name: createForm.name,
            description: createForm.description || undefined,
            type: createForm.type,
            value: createForm.value,
            source: createForm.source,
            validFrom: createForm.validFrom.toISOString(),
            validUntil: createForm.validUntil.toISOString(),
            maxUses: createForm.maxUses,
            minPurchase: createForm.minPurchase || undefined,
          },
        });

        closeCreate();
        setCreateForm({
          code: "",
          name: "",
          description: "",
          type: "percentage",
          value: 10,
          source: "promotion",
          validFrom: new Date(),
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          maxUses: 1,
          minPurchase: 0,
        });
        setRefreshKey((k) => k + 1);
      },
    },
    [createForm],
  );

  const filters = t.object({
    query: t.optional(t.text()),
    status: t.optional(t.enum(["active", "used", "expired", "revoked"])),
    type: t.optional(
      t.enum([
        "percentage",
        "fixed_amount",
        "free_upgrade",
        "free_seat_selection",
        "points_multiplier",
      ]),
    ),
    source: t.optional(
      t.enum([
        "welcome",
        "loyalty",
        "promotion",
        "compensation",
        "referral",
        "birthday",
        "gift",
        "partner",
      ]),
    ),
  });

  const formatValue = (voucher: Voucher) => {
    switch (voucher.type) {
      case "percentage":
        return `${voucher.value}%`;
      case "fixed_amount":
        return `€${voucher.value.toFixed(2)}`;
      case "points_multiplier":
        return `${voucher.value}x`;
      default:
        return "Free";
    }
  };

  return (
    <Flex flex={1} direction="column">
      <DataTable<Voucher, typeof filters>
        key={refreshKey}
        submitOnInit
        actions={[
          {
            icon: IconGift,
            onClick: openCreate,
            label: "Create Voucher",
          },
        ]}
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 4,
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
          style: { cursor: item.customerId ? "pointer" : undefined },
          onClick: () => {
            if (item.customerId) {
              router.go("adminCustomerVouchers", {
                params: { customerId: item.customerId },
              });
            }
          },
        })}
        items={async (filters) => {
          const response = await client.findVouchers({
            query: filters,
          });
          return response as Page<Voucher>;
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
                {item.description && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {item.description}
                  </Text>
                )}
              </Stack>
            ),
          },
          type: {
            label: "Value",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color="pink"
                leftSection={<IconPercentage size={10} />}
              >
                {formatValue(item)} {typeLabels[item.type]}
              </Badge>
            ),
          },
          source: {
            label: "Source",
            fit: true,
            value: (item) => (
              <Badge size="sm" variant="outline" color="gray">
                {item.source.charAt(0).toUpperCase() + item.source.slice(1)}
              </Badge>
            ),
          },
          validity: {
            label: "Validity",
            value: (item) => (
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  {l(item.validFrom, { date: "short" })}
                </Text>
                <Text size="xs" c="dimmed">
                  →
                </Text>
                <Text size="xs" c="dimmed">
                  {l(item.validUntil, { date: "short" })}
                </Text>
              </Group>
            ),
          },
          usage: {
            label: "Usage",
            fit: true,
            value: (item) => (
              <Text size="sm" c="dimmed">
                {item.currentUses}/{item.maxUses}
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
          createdAt: {
            label: "Created",
            fit: true,
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
        }}
      />

      {/* Create Voucher Modal */}
      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title="Create Voucher"
        size="lg"
      >
        <Stack gap="md">
          <Group grow>
            <TextInput
              label="Code"
              placeholder="SUMMER20"
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
              placeholder="Summer Sale 20% Off"
              required
              value={createForm.name}
              onChange={(e) =>
                setCreateForm({ ...createForm, name: e.currentTarget.value })
              }
            />
          </Group>

          <TextInput
            label="Description"
            placeholder="Optional description"
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
              label="Type"
              required
              data={[
                { value: "percentage", label: "Percentage Off" },
                { value: "fixed_amount", label: "Fixed Amount" },
                { value: "free_upgrade", label: "Free Upgrade" },
                { value: "free_seat_selection", label: "Free Seat Selection" },
                { value: "points_multiplier", label: "Points Multiplier" },
              ]}
              value={createForm.type}
              onChange={(v) =>
                setCreateForm({
                  ...createForm,
                  type: (v as VoucherType) || "percentage",
                })
              }
            />
            <NumberInput
              label={
                createForm.type === "percentage"
                  ? "Discount %"
                  : createForm.type === "fixed_amount"
                    ? "Amount (€)"
                    : createForm.type === "points_multiplier"
                      ? "Multiplier"
                      : "Value"
              }
              required
              min={0}
              max={createForm.type === "percentage" ? 100 : undefined}
              value={createForm.value}
              onChange={(v) =>
                setCreateForm({ ...createForm, value: Number(v) })
              }
            />
          </Group>

          <Group grow>
            <Select
              label="Source"
              required
              data={[
                { value: "welcome", label: "Welcome" },
                { value: "loyalty", label: "Loyalty" },
                { value: "promotion", label: "Promotion" },
                { value: "compensation", label: "Compensation" },
                { value: "referral", label: "Referral" },
                { value: "birthday", label: "Birthday" },
                { value: "gift", label: "Gift" },
                { value: "partner", label: "Partner" },
              ]}
              value={createForm.source}
              onChange={(v) =>
                setCreateForm({
                  ...createForm,
                  source: (v as VoucherSource) || "promotion",
                })
              }
            />
            <NumberInput
              label="Max Uses"
              required
              min={1}
              value={createForm.maxUses}
              onChange={(v) =>
                setCreateForm({ ...createForm, maxUses: Number(v) })
              }
            />
          </Group>

          <Group grow>
            <DateTimePicker
              label="Valid From"
              required
              value={createForm.validFrom}
              onChange={(v) => {
                const date = v
                  ? typeof v === "string"
                    ? new Date(v)
                    : v
                  : new Date();
                setCreateForm({ ...createForm, validFrom: date });
              }}
            />
            <DateTimePicker
              label="Valid Until"
              required
              value={createForm.validUntil}
              onChange={(v) => {
                const date = v
                  ? typeof v === "string"
                    ? new Date(v)
                    : v
                  : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                setCreateForm({ ...createForm, validUntil: date });
              }}
            />
          </Group>

          <NumberInput
            label="Minimum Purchase (€)"
            description="Leave at 0 for no minimum"
            min={0}
            value={createForm.minPurchase}
            onChange={(v) =>
              setCreateForm({ ...createForm, minPurchase: Number(v) })
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
              disabled={!createForm.code || !createForm.name}
            >
              Create
            </ActionButton>
          </Group>
        </Stack>
      </Modal>
    </Flex>
  );
};

export default AdminVouchers;
