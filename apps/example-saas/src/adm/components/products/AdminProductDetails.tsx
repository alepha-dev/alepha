import { useAction, useClient, useRouter, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Group,
  Image,
  Loader,
  NumberInput,
  Select,
  Stack,
  Switch,
  Textarea,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import {
  IconBox,
  IconCategory,
  IconCheck,
  IconCurrencyEuro,
  IconEdit,
  IconPercentage,
  IconShoppingCart,
  IconTag,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
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

const sellTypeLabels: Record<string, string> = {
  standalone: "Standalone Only",
  with_booking: "With Booking Only",
  both: "Both Standalone & Booking",
};

const AdminProductDetails = () => {
  const state = useRouterState();
  const client = useClient<ProductController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();
  const productId = state.params.productId as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  // Edit form state
  const [editForm, setEditForm] = useState<{
    name: string;
    description: string;
    sku: string;
    price: number;
    category: Product["category"];
    sellType: Product["sellType"];
    stock: number | undefined;
    trackStock: boolean;
    minQuantity: number;
    maxQuantity: number | undefined;
    taxRate: number | undefined;
  }>({
    name: "",
    description: "",
    sku: "",
    price: 0,
    category: "food_beverage",
    sellType: "both",
    stock: undefined,
    trackStock: false,
    minQuantity: 1,
    maxQuantity: undefined,
    taxRate: undefined,
  });

  const loadProduct = async () => {
    try {
      const data = await client.getProductAdmin({
        params: { id: productId },
      });
      setProduct(data);
      setEditForm({
        name: data.name,
        description: data.description || "",
        sku: data.sku,
        price: data.price,
        category: data.category,
        sellType: data.sellType,
        stock: data.stock,
        trackStock: data.trackStock,
        minQuantity: data.minQuantity,
        maxQuantity: data.maxQuantity,
        taxRate: data.taxRate,
      });

      // Load image URL
      if (data.imageId) {
        const imageData = await client.getProductImage({
          params: { id: productId },
        });
        setImageUrl(imageData.imageUrl);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProduct();
  }, [productId]);

  const updateAction = useAction(
    {
      handler: async () => {
        await client.updateProduct({
          params: { id: productId },
          body: {
            name: editForm.name,
            description: editForm.description || undefined,
            sku: editForm.sku,
            price: editForm.price,
            category: editForm.category,
            sellType: editForm.sellType,
            stock: editForm.stock,
            trackStock: editForm.trackStock,
            minQuantity: editForm.minQuantity,
            maxQuantity: editForm.maxQuantity,
            taxRate: editForm.taxRate,
          },
        });
        setEditing(false);
        await loadProduct();
      },
    },
    [editForm, productId],
  );

  const toggleActiveAction = useAction(
    {
      handler: async () => {
        await client.toggleProductActive({
          params: { id: productId },
        });
        await loadProduct();
      },
    },
    [productId],
  );

  const deleteAction = useAction(
    {
      handler: async () => {
        if (!confirm("Are you sure you want to delete this product?")) return;
        await client.deleteProduct({
          params: { id: productId },
        });
        router.go("adminProducts", {});
      },
    },
    [productId],
  );

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!product) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Product not found</Text>
      </Flex>
    );
  }

  return (
    <Flex flex={1} direction="column" gap="md">
      {/* Action Buttons */}
      <Group justify="flex-end">
        <ActionButton
          variant="subtle"
          color={product.active ? "orange" : "green"}
          leftSection={
            product.active ? <IconX size={16} /> : <IconCheck size={16} />
          }
          onClick={toggleActiveAction.run}
          loading={toggleActiveAction.loading}
        >
          {product.active ? "Deactivate" : "Activate"}
        </ActionButton>
        <ActionButton
          variant="subtle"
          leftSection={<IconEdit size={16} />}
          onClick={() => setEditing(!editing)}
        >
          {editing ? "Cancel Edit" : "Edit"}
        </ActionButton>
        <ActionButton
          variant="subtle"
          color="red"
          leftSection={<IconTrash size={16} />}
          onClick={deleteAction.run}
          loading={deleteAction.loading}
        >
          Delete
        </ActionButton>
      </Group>

      <Grid>
        {/* Product Image */}
        {imageUrl && (
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card withBorder h="100%">
              <Stack gap="md">
                <Text fw={600}>Product Image</Text>
                <Image
                  src={imageUrl}
                  alt={product.name}
                  radius="md"
                  fit="contain"
                  h={200}
                />
              </Stack>
            </Card>
          </Grid.Col>
        )}

        {/* Basic Information */}
        <Grid.Col span={{ base: 12, md: imageUrl ? 8 : 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Basic Information</Text>

              {editing ? (
                <Stack gap="sm">
                  <TextInput
                    label="Product Name"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.currentTarget.value })
                    }
                  />
                  <TextInput
                    label="SKU"
                    value={editForm.sku}
                    onChange={(e) =>
                      setEditForm({ ...editForm, sku: e.currentTarget.value })
                    }
                  />
                  <Textarea
                    label="Description"
                    value={editForm.description}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        description: e.currentTarget.value,
                      })
                    }
                    minRows={3}
                  />
                </Stack>
              ) : (
                <Stack gap="sm">
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="gray">
                      <IconTag size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      SKU
                    </Text>
                    <Text size="sm" ff="monospace">
                      {product.sku}
                    </Text>
                  </Group>

                  {product.description && (
                    <Group gap="sm" align="flex-start">
                      <ThemeIcon size="sm" variant="light" color="gray">
                        <IconBox size={14} />
                      </ThemeIcon>
                      <Text size="sm" c="dimmed" w={100}>
                        Description
                      </Text>
                      <Text size="sm" style={{ flex: 1 }}>
                        {product.description}
                      </Text>
                    </Group>
                  )}

                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="gray">
                      <IconCategory size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      Category
                    </Text>
                    <Text size="sm">
                      {categoryLabels[product.category] || product.category}
                    </Text>
                  </Group>

                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="gray">
                      <IconShoppingCart size={14} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed" w={100}>
                      Sell Type
                    </Text>
                    <Text size="sm">
                      {sellTypeLabels[product.sellType] || product.sellType}
                    </Text>
                  </Group>
                </Stack>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Pricing & Inventory */}
        <Grid.Col span={{ base: 12, md: imageUrl ? 12 : 6 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Pricing & Inventory</Text>

              {editing ? (
                <Stack gap="sm">
                  <Group grow>
                    <NumberInput
                      label="Price"
                      value={editForm.price}
                      onChange={(v) =>
                        setEditForm({ ...editForm, price: Number(v) || 0 })
                      }
                      min={0}
                      decimalScale={2}
                    />
                    <Select
                      label="Category"
                      data={Object.entries(categoryLabels).map(
                        ([value, label]) => ({
                          value,
                          label,
                        }),
                      )}
                      value={editForm.category}
                      onChange={(v) =>
                        setEditForm({
                          ...editForm,
                          category: v as Product["category"],
                        })
                      }
                    />
                  </Group>
                  <Group grow>
                    <Select
                      label="Sell Type"
                      data={Object.entries(sellTypeLabels).map(
                        ([value, label]) => ({
                          value,
                          label,
                        }),
                      )}
                      value={editForm.sellType}
                      onChange={(v) =>
                        setEditForm({
                          ...editForm,
                          sellType: v as Product["sellType"],
                        })
                      }
                    />
                    <NumberInput
                      label="Tax Rate %"
                      value={editForm.taxRate ?? ""}
                      onChange={(v) =>
                        setEditForm({
                          ...editForm,
                          taxRate: v !== "" ? Number(v) : undefined,
                        })
                      }
                      min={0}
                      max={100}
                    />
                  </Group>
                  <Switch
                    label="Track Stock"
                    checked={editForm.trackStock}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        trackStock: e.currentTarget.checked,
                      })
                    }
                  />
                  {editForm.trackStock && (
                    <NumberInput
                      label="Stock Quantity"
                      value={editForm.stock ?? ""}
                      onChange={(v) =>
                        setEditForm({
                          ...editForm,
                          stock: v !== "" ? Number(v) : undefined,
                        })
                      }
                      min={0}
                    />
                  )}
                  <Group grow>
                    <NumberInput
                      label="Min Quantity"
                      value={editForm.minQuantity}
                      onChange={(v) =>
                        setEditForm({
                          ...editForm,
                          minQuantity: Number(v) || 1,
                        })
                      }
                      min={1}
                    />
                    <NumberInput
                      label="Max Quantity"
                      value={editForm.maxQuantity ?? ""}
                      onChange={(v) =>
                        setEditForm({
                          ...editForm,
                          maxQuantity: v !== "" ? Number(v) : undefined,
                        })
                      }
                      min={1}
                    />
                  </Group>
                </Stack>
              ) : (
                <Grid>
                  <Grid.Col span={6}>
                    <Group gap="sm">
                      <ThemeIcon size="lg" variant="light" color="blue">
                        <IconCurrencyEuro size={18} />
                      </ThemeIcon>
                      <Stack gap={0}>
                        <Text size="lg" fw={600}>
                          {product.currency} {product.price.toFixed(2)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          Price
                        </Text>
                      </Stack>
                    </Group>
                  </Grid.Col>
                  {product.trackStock && (
                    <Grid.Col span={6}>
                      <Group gap="sm">
                        <ThemeIcon
                          size="lg"
                          variant="light"
                          color={
                            product.stock && product.stock > 0 ? "green" : "red"
                          }
                        >
                          <IconBox size={18} />
                        </ThemeIcon>
                        <Stack gap={0}>
                          <Text size="lg" fw={600}>
                            {product.stock ?? 0}
                          </Text>
                          <Text size="xs" c="dimmed">
                            In Stock
                          </Text>
                        </Stack>
                      </Group>
                    </Grid.Col>
                  )}
                  {product.taxRate && (
                    <Grid.Col span={6}>
                      <Group gap="sm">
                        <ThemeIcon size="lg" variant="light" color="gray">
                          <IconPercentage size={18} />
                        </ThemeIcon>
                        <Stack gap={0}>
                          <Text size="lg" fw={600}>
                            {product.taxRate}%
                          </Text>
                          <Text size="xs" c="dimmed">
                            Tax Rate
                          </Text>
                        </Stack>
                      </Group>
                    </Grid.Col>
                  )}
                  <Grid.Col span={12}>
                    <Stack gap="xs">
                      <Group gap="xs">
                        <Text size="sm" c="dimmed">
                          Min Quantity:
                        </Text>
                        <Text size="sm">{product.minQuantity}</Text>
                        {product.maxQuantity && (
                          <>
                            <Text size="sm" c="dimmed">
                              • Max Quantity:
                            </Text>
                            <Text size="sm">{product.maxQuantity}</Text>
                          </>
                        )}
                      </Group>
                    </Stack>
                  </Grid.Col>
                </Grid>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Metadata */}
        <Grid.Col span={12}>
          <Card withBorder>
            <Stack gap="md">
              <Text fw={600}>Metadata</Text>
              <Grid>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">
                      Created:
                    </Text>
                    <Text size="sm">
                      {l(product.createdAt, { date: "long" })}
                    </Text>
                  </Group>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">
                      Updated:
                    </Text>
                    <Text size="sm">
                      {l(product.updatedAt, { date: "long" })}
                    </Text>
                  </Group>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Group gap="xs">
                    <Text size="sm" c="dimmed">
                      Sort Order:
                    </Text>
                    <Text size="sm">{product.sortOrder}</Text>
                  </Group>
                </Grid.Col>
                {product.tags && product.tags.length > 0 && (
                  <Grid.Col span={12}>
                    <Group gap="xs">
                      <Text size="sm" c="dimmed">
                        Tags:
                      </Text>
                      {product.tags.map((tag) => (
                        <Badge key={tag} size="sm" variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                  </Grid.Col>
                )}
              </Grid>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Save Button */}
      {editing && (
        <Group justify="flex-end">
          <ActionButton
            variant="filled"
            color="pink"
            onClick={updateAction.run}
            loading={updateAction.loading}
          >
            Save Changes
          </ActionButton>
        </Group>
      )}
    </Flex>
  );
};

export default AdminProductDetails;
