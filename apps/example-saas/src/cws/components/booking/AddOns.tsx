import { useClient, useRouter, useStore } from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Group,
  NumberInput,
  Stack,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBox,
  IconDeviceGamepad,
  IconGift,
  IconHeadphones,
  IconShield,
  IconSofa,
  IconToolsKitchen2,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ProductController } from "../../../api/products/controllers/ProductController.ts";
import type { Product } from "../../../api/products/entities/products.ts";
import { bookingAtom, type SelectedAddOn } from "../../atoms/bookingAtom.ts";
import type { CwsRouter } from "../../CwsRouter.ts";

const categoryIcons: Record<string, typeof IconBox> = {
  food_beverage: IconToolsKitchen2,
  comfort: IconSofa,
  entertainment: IconDeviceGamepad,
  travel_accessories: IconBox,
  merchandise: IconGift,
  insurance: IconShield,
  services: IconHeadphones,
};

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

const AddOns = () => {
  const client = useClient<ProductController>();
  const router = useRouter<CwsRouter>();
  const [booking, setBooking] = useStore(bookingAtom);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    const loadProducts = async () => {
      try {
        // Get products that can be sold with bookings
        const data = await client.getProducts({
          query: { sellType: "with_booking" },
        });
        setProducts(data);

        // Initialize quantities from existing selections
        const initialQuantities: Record<string, number> = {};
        for (const addOn of booking.selectedAddOns) {
          initialQuantities[addOn.productId] = addOn.quantity;
        }
        setQuantities(initialQuantities);
      } finally {
        setLoading(false);
      }
    };

    loadProducts();
  }, []);

  const handleQuantityChange = (product: Product, quantity: number) => {
    setQuantities((prev) => ({
      ...prev,
      [product.id]: quantity,
    }));
  };

  const calculateTotal = (): number => {
    let total = 0;
    for (const product of products) {
      const qty = quantities[product.id] || 0;
      if (qty > 0) {
        const subtotal = product.price * qty;
        const tax = subtotal * ((product.taxRate ?? 0) / 100);
        total += subtotal + tax;
      }
    }
    return total;
  };

  const handleContinue = () => {
    // Build selected add-ons
    const selectedAddOns: SelectedAddOn[] = [];

    for (const product of products) {
      const qty = quantities[product.id] || 0;
      if (qty > 0) {
        const subtotal = product.price * qty;
        const taxRate = product.taxRate ?? 0;
        const tax = subtotal * (taxRate / 100);

        selectedAddOns.push({
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          category: product.category,
          quantity: qty,
          unitPrice: product.price,
          taxRate,
          total: subtotal + tax,
        });
      }
    }

    const addOnsTotal = selectedAddOns.reduce((sum, a) => sum + a.total, 0);

    setBooking({
      ...booking,
      step: "payment",
      selectedAddOns,
      addOnsTotal: addOnsTotal > 0 ? addOnsTotal : undefined,
    });

    router.go("bookingPayment", {});
  };

  // Group products by category
  const productsByCategory = products.reduce(
    (acc, product) => {
      if (!acc[product.category]) {
        acc[product.category] = [];
      }
      acc[product.category].push(product);
      return acc;
    },
    {} as Record<string, Product[]>,
  );

  const addOnsTotal = calculateTotal();
  const hasSelections = Object.values(quantities).some((q) => q > 0);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center" py="xl">
        <Text c="dimmed">Loading add-ons...</Text>
      </Flex>
    );
  }

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Title order={3}>Enhance Your Journey</Title>
        <Text c="dimmed">
          Add extras to make your trip more comfortable and enjoyable.
        </Text>
      </Stack>

      {products.length === 0 ? (
        <Card withBorder p="xl">
          <Text ta="center" c="dimmed">
            No add-ons available for this booking.
          </Text>
        </Card>
      ) : (
        <Stack gap="xl">
          {Object.entries(productsByCategory).map(
            ([category, categoryProducts]) => (
              <Stack key={category} gap="md">
                <Group gap="xs">
                  <ThemeIcon
                    size="sm"
                    variant="light"
                    color={categoryColors[category] || "gray"}
                  >
                    {(() => {
                      const Icon = categoryIcons[category] || IconBox;
                      return <Icon size={14} />;
                    })()}
                  </ThemeIcon>
                  <Text fw={600}>{categoryLabels[category] || category}</Text>
                </Group>

                <Grid>
                  {categoryProducts.map((product) => {
                    const quantity = quantities[product.id] || 0;
                    const isSelected = quantity > 0;

                    return (
                      <Grid.Col
                        key={product.id}
                        span={{ base: 12, sm: 6, md: 4 }}
                      >
                        <Card
                          withBorder
                          h="100%"
                          style={{
                            borderColor: isSelected
                              ? "var(--mantine-primary-color-filled)"
                              : undefined,
                          }}
                        >
                          <Stack gap="sm" h="100%">
                            <Group justify="space-between" align="flex-start">
                              <Stack gap={2} style={{ flex: 1 }}>
                                <Text size="sm" fw={500}>
                                  {product.name}
                                </Text>
                                {product.description && (
                                  <Text size="xs" c="dimmed" lineClamp={2}>
                                    {product.description}
                                  </Text>
                                )}
                              </Stack>
                              <Text size="sm" fw={600} ff="monospace">
                                {product.currency} {product.price.toFixed(2)}
                              </Text>
                            </Group>

                            <Group justify="space-between" mt="auto">
                              {product.taxRate && product.taxRate > 0 && (
                                <Text size="xs" c="dimmed">
                                  +{product.taxRate}% tax
                                </Text>
                              )}
                              <NumberInput
                                size="xs"
                                w={80}
                                min={0}
                                max={product.maxQuantity ?? 10}
                                value={quantity}
                                onChange={(val) =>
                                  handleQuantityChange(
                                    product,
                                    Number(val) || 0,
                                  )
                                }
                              />
                            </Group>
                          </Stack>
                        </Card>
                      </Grid.Col>
                    );
                  })}
                </Grid>
              </Stack>
            ),
          )}
        </Stack>
      )}

      {/* Summary */}
      {hasSelections && (
        <Card withBorder bd="1px solid var(--mantine-primary-color-filled)">
          <Group justify="space-between">
            <Stack gap={0}>
              <Text size="sm" c="dimmed">
                Add-ons Total
              </Text>
              <Text size="lg" fw={700} ff="monospace">
                EUR {addOnsTotal.toFixed(2)}
              </Text>
            </Stack>
            <Badge size="lg" variant="light" color="pink">
              {Object.values(quantities).filter((q) => q > 0).length} item
              {Object.values(quantities).filter((q) => q > 0).length !== 1
                ? "s"
                : ""}
            </Badge>
          </Group>
        </Card>
      )}

      {/* Continue button */}
      <Group justify="flex-end">
        <ActionButton
          variant="filled"
          color="pink"
          size="lg"
          rightSection={<IconArrowRight size={16} />}
          onClick={handleContinue}
        >
          {hasSelections
            ? `Continue with EUR ${addOnsTotal.toFixed(2)}`
            : "Continue to Payment"}
        </ActionButton>
      </Group>
    </Stack>
  );
};

export default AddOns;
