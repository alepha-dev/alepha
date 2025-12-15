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
  Switch,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCheck, IconPackage, IconPlus, IconX } from "@tabler/icons-react";
import { type Page, t } from "alepha";
import { useState } from "react";
import type { ProductController } from "../../../api/products/controllers/ProductController.ts";
import type { Product } from "../../../api/products/entities/products.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

const categoryLabels: Record<string, string> = {
  food_beverage: "Food & Beverage",
  comfort: "Comfort",
  entertainment: "Entertainment",
  travel_accessories: "Travel Accessories",
  merchandise: "Merchandise",
  insurance: "Insurance",
  services: "Services",
};

const categoryColors: Record<string, string> = {
  food_beverage: "orange",
  comfort: "blue",
  entertainment: "grape",
  travel_accessories: "teal",
  merchandise: "pink",
  insurance: "cyan",
  services: "violet",
};

const sellTypeLabels: Record<string, string> = {
  standalone: "Standalone",
  with_booking: "With Booking",
  both: "Both",
};

const AdminProducts = () => {
  const client = useClient<ProductController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const [createOpened, { open: openCreate, close: closeCreate }] =
    useDisclosure(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Create form state
  const [createForm, setCreateForm] = useState<{
    name: string;
    description: string;
    sku: string;
    price: number;
    category: "" | Product["category"];
    sellType: Product["sellType"];
    trackStock: boolean;
    stock: number | undefined;
    active: boolean;
  }>({
    name: "",
    description: "",
    sku: "",
    price: 0,
    category: "",
    sellType: "both",
    trackStock: false,
    stock: undefined,
    active: true,
  });

  const createAction = useAction(
    {
      handler: async () => {
        if (!createForm.name || !createForm.sku || !createForm.category) return;

        await client.createProduct({
          body: {
            name: createForm.name,
            description: createForm.description || undefined,
            sku: createForm.sku,
            price: createForm.price,
            category: createForm.category as Product["category"],
            sellType: createForm.sellType,
            trackStock: createForm.trackStock,
            stock: createForm.stock,
            active: createForm.active,
          },
        });

        closeCreate();
        setCreateForm({
          name: "",
          description: "",
          sku: "",
          price: 0,
          category: "",
          sellType: "both",
          trackStock: false,
          stock: undefined,
          active: true,
        });
        setRefreshKey((k) => k + 1);
      },
    },
    [createForm],
  );

  const filters = t.object({
    query: t.optional(t.text()),
    category: t.optional(
      t.enum([
        "food_beverage",
        "comfort",
        "entertainment",
        "travel_accessories",
        "merchandise",
        "insurance",
        "services",
      ]),
    ),
    sellType: t.optional(t.enum(["standalone", "with_booking", "both"])),
    active: t.optional(t.boolean()),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<Product, typeof filters>
        key={refreshKey}
        submitOnInit
        actions={[
          {
            icon: IconPlus,
            onClick: openCreate,
            label: "Create Product",
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
          style: { cursor: "pointer" },
          onClick: () =>
            router.go("adminProductDetails", {
              params: { productId: item.id },
            }),
        })}
        items={async (filters) => {
          const response = await client.findProducts({
            query: filters,
          });
          return response as Page<Product>;
        }}
        columns={{
          product: {
            label: "Product",
            value: (item) => (
              <Group gap="sm">
                <IconPackage size={20} />
                <Stack gap={2}>
                  <Text size="sm" fw={500}>
                    {item.name}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {item.sku}
                  </Text>
                </Stack>
              </Group>
            ),
          },
          category: {
            label: "Category",
            fit: true,
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={categoryColors[item.category] || "gray"}
              >
                {categoryLabels[item.category] || item.category}
              </Badge>
            ),
          },
          sellType: {
            label: "Sell Type",
            fit: true,
            value: (item) => (
              <Text size="sm" c="dimmed">
                {sellTypeLabels[item.sellType] || item.sellType}
              </Text>
            ),
          },
          price: {
            label: "Price",
            fit: true,
            value: (item) => (
              <Text size="sm" fw={500} ff="monospace">
                {item.currency} {item.price.toFixed(2)}
              </Text>
            ),
          },
          stock: {
            label: "Stock",
            fit: true,
            value: (item) =>
              item.trackStock ? (
                <Text
                  size="sm"
                  c={item.stock && item.stock > 0 ? undefined : "red"}
                >
                  {item.stock ?? 0}
                </Text>
              ) : (
                <Text size="sm" c="dimmed">
                  —
                </Text>
              ),
          },
          active: {
            label: "Status",
            fit: true,
            value: (item) =>
              item.active ? (
                <Badge
                  size="sm"
                  variant="light"
                  color="green"
                  leftSection={<IconCheck size={10} />}
                >
                  Active
                </Badge>
              ) : (
                <Badge
                  size="sm"
                  variant="light"
                  color="gray"
                  leftSection={<IconX size={10} />}
                >
                  Inactive
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

      {/* Create Product Modal */}
      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title="Create Product"
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Product Name"
            placeholder="Premium Coffee"
            required
            value={createForm.name}
            onChange={(e) =>
              setCreateForm({ ...createForm, name: e.currentTarget.value })
            }
          />

          <TextInput
            label="SKU"
            placeholder="PROD-001"
            required
            value={createForm.sku}
            onChange={(e) =>
              setCreateForm({ ...createForm, sku: e.currentTarget.value })
            }
          />

          <Textarea
            label="Description"
            placeholder="A delicious cup of premium coffee"
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
              label="Category"
              placeholder="Select category"
              required
              data={Object.entries(categoryLabels).map(([value, label]) => ({
                value,
                label,
              }))}
              value={createForm.category}
              onChange={(v) =>
                setCreateForm({
                  ...createForm,
                  category: (v as Product["category"]) || "",
                })
              }
            />

            <Select
              label="Sell Type"
              placeholder="Select sell type"
              data={Object.entries(sellTypeLabels).map(([value, label]) => ({
                value,
                label,
              }))}
              value={createForm.sellType}
              onChange={(v) =>
                setCreateForm({
                  ...createForm,
                  sellType: (v as Product["sellType"]) || "both",
                })
              }
            />
          </Group>

          <Group grow>
            <NumberInput
              label="Price"
              placeholder="9.99"
              required
              min={0}
              decimalScale={2}
              value={createForm.price}
              onChange={(v) =>
                setCreateForm({ ...createForm, price: Number(v) || 0 })
              }
            />

            {createForm.trackStock && (
              <NumberInput
                label="Initial Stock"
                placeholder="100"
                min={0}
                value={createForm.stock}
                onChange={(v) =>
                  setCreateForm({
                    ...createForm,
                    stock: v !== "" ? Number(v) : undefined,
                  })
                }
              />
            )}
          </Group>

          <Group>
            <Switch
              label="Track Stock"
              checked={createForm.trackStock}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  trackStock: e.currentTarget.checked,
                  stock: e.currentTarget.checked ? 0 : undefined,
                })
              }
            />

            <Switch
              label="Active"
              checked={createForm.active}
              onChange={(e) =>
                setCreateForm({
                  ...createForm,
                  active: e.currentTarget.checked,
                })
              }
            />
          </Group>

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
                !createForm.name || !createForm.sku || !createForm.category
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

export default AdminProducts;
