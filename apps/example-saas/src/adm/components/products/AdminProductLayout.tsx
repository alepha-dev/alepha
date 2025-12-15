import { NestedView, useClient, useRouterState } from "@alepha/react";
import { Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack } from "@mantine/core";
import { IconCheck, IconPackage, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ProductController } from "../../../api/products/controllers/ProductController.ts";
import type { Product } from "../../../api/products/entities/products.ts";

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

const AdminProductLayout = () => {
  const state = useRouterState();
  const client = useClient<ProductController>();
  const productId = state.params.productId as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProduct = async () => {
      try {
        const data = await client.getProductAdmin({
          params: { id: productId },
        });
        setProduct(data);
      } finally {
        setLoading(false);
      }
    };

    loadProduct();
  }, [productId]);

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
    <Flex flex={1} direction="column" gap="md" p="md">
      <Card withBorder p="md">
        <Group justify="space-between">
          <Group>
            <IconPackage size={32} color="var(--mantine-color-blue-6)" />
            <Stack gap={4}>
              <Group gap="xs">
                <Text size="lg" fw={600}>
                  {product.name}
                </Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={categoryColors[product.category] || "gray"}
                >
                  {categoryLabels[product.category] || product.category}
                </Badge>
                {product.active ? (
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
                )}
              </Group>
              <Text size="sm" c="dimmed" ff="monospace">
                {product.sku}
              </Text>
            </Stack>
          </Group>
          <Stack gap={4} align="flex-end">
            <Text size="xl" fw={700} c="blue">
              {product.currency} {product.price.toFixed(2)}
            </Text>
            {product.trackStock && (
              <Text size="xs" c="dimmed">
                {product.stock ?? 0} in stock
              </Text>
            )}
          </Stack>
        </Group>
      </Card>

      <Flex flex={1}>
        <NestedView />
      </Flex>
    </Flex>
  );
};

export default AdminProductLayout;
