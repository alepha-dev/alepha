import { useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Group,
  Loader,
  Progress,
  Stack,
  Table,
  ThemeIcon,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCash,
  IconReceipt,
  IconShoppingCart,
  IconTrendingUp,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ProductOrderController } from "../../../api/orders/controllers/ProductOrderController.ts";
import type { ProductOrder } from "../../../api/orders/entities/productOrders.ts";
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

const statusColors: Record<string, string> = {
  pending: "yellow",
  confirmed: "blue",
  processing: "cyan",
  fulfilled: "green",
  partially_fulfilled: "teal",
  cancelled: "gray",
  refunded: "red",
};

interface SalesStats {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  ordersByStatus: Record<string, number>;
  ordersByChannel: Record<string, number>;
  ordersByPaymentStatus: Record<string, number>;
  bookingAddOns: number;
  standaloneOrders: number;
}

interface ProductSales {
  productId: string;
  productName: string;
  productSku: string;
  category: string;
  totalQuantity: number;
  totalRevenue: number;
  orderCount: number;
}

interface CategorySales {
  category: string;
  totalQuantity: number;
  totalRevenue: number;
  orderCount: number;
  productCount: number;
}

const AdminProductSales = () => {
  const client = useClient<ProductOrderController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();

  const [stats, setStats] = useState<SalesStats | null>(null);
  const [productSales, setProductSales] = useState<ProductSales[]>([]);
  const [categorySales, setCategorySales] = useState<CategorySales[]>([]);
  const [recentOrders, setRecentOrders] = useState<ProductOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [statsData, productData, categoryData, recentData] =
          await Promise.all([
            client.getSalesStats({ query: {} }),
            client.getSalesByProduct({ query: { limit: 10 } }),
            client.getSalesByCategory({ query: {} }),
            client.getRecentOrders({ query: { limit: 5 } }),
          ]);

        setStats(statsData);
        setProductSales(productData);
        setCategorySales(categoryData);
        setRecentOrders(recentData);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!stats) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Failed to load sales data</Text>
      </Flex>
    );
  }

  const totalCategoryRevenue = categorySales.reduce(
    (sum, c) => sum + c.totalRevenue,
    0,
  );

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      {/* Key Metrics */}
      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Card withBorder h="100%">
            <Group justify="space-between" align="flex-start">
              <Stack gap={0}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
                  Total Revenue
                </Text>
                <Text size="xl" fw={700} ff="monospace">
                  EUR {stats.totalRevenue.toFixed(2)}
                </Text>
                <Text size="xs" c="dimmed">
                  From paid orders
                </Text>
              </Stack>
              <ThemeIcon size="lg" variant="light" color="green">
                <IconCash size={20} />
              </ThemeIcon>
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Card withBorder h="100%">
            <Group justify="space-between" align="flex-start">
              <Stack gap={0}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
                  Total Orders
                </Text>
                <Text size="xl" fw={700}>
                  {stats.totalOrders}
                </Text>
                <Text size="xs" c="dimmed">
                  All time
                </Text>
              </Stack>
              <ThemeIcon size="lg" variant="light" color="blue">
                <IconReceipt size={20} />
              </ThemeIcon>
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Card withBorder h="100%">
            <Group justify="space-between" align="flex-start">
              <Stack gap={0}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
                  Average Order
                </Text>
                <Text size="xl" fw={700} ff="monospace">
                  EUR {stats.averageOrderValue.toFixed(2)}
                </Text>
                <Text size="xs" c="dimmed">
                  Per order
                </Text>
              </Stack>
              <ThemeIcon size="lg" variant="light" color="violet">
                <IconTrendingUp size={20} />
              </ThemeIcon>
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Card withBorder h="100%">
            <Group justify="space-between" align="flex-start">
              <Stack gap={0}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
                  Order Types
                </Text>
                <Group gap="xs" mt={4}>
                  <Badge size="sm" variant="light" color="violet">
                    {stats.bookingAddOns} Add-ons
                  </Badge>
                  <Badge size="sm" variant="light" color="blue">
                    {stats.standaloneOrders} Standalone
                  </Badge>
                </Group>
              </Stack>
              <ThemeIcon size="lg" variant="light" color="orange">
                <IconShoppingCart size={20} />
              </ThemeIcon>
            </Group>
          </Card>
        </Grid.Col>
      </Grid>

      <Grid>
        {/* Orders by Status */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Orders by Status</Text>
              <Stack gap="xs">
                {Object.entries(stats.ordersByStatus).map(([status, count]) => (
                  <Group key={status} justify="space-between">
                    <Group gap="xs">
                      <Badge
                        size="xs"
                        variant="light"
                        color={statusColors[status] || "gray"}
                      >
                        {status}
                      </Badge>
                    </Group>
                    <Text size="sm" fw={500}>
                      {count}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Sales by Category */}
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Text fw={600}>Sales by Category</Text>
              {categorySales.length > 0 ? (
                <Stack gap="sm">
                  {categorySales.map((cat) => {
                    const percentage =
                      totalCategoryRevenue > 0
                        ? (cat.totalRevenue / totalCategoryRevenue) * 100
                        : 0;
                    return (
                      <Stack key={cat.category} gap={4}>
                        <Group justify="space-between">
                          <Group gap="xs">
                            <Badge
                              size="sm"
                              variant="light"
                              color={categoryColors[cat.category] || "gray"}
                            >
                              {categoryLabels[cat.category] || cat.category}
                            </Badge>
                            <Text size="xs" c="dimmed">
                              {cat.productCount} products, {cat.orderCount}{" "}
                              orders
                            </Text>
                          </Group>
                          <Text size="sm" fw={500} ff="monospace">
                            EUR {cat.totalRevenue.toFixed(2)}
                          </Text>
                        </Group>
                        <Progress
                          value={percentage}
                          size="sm"
                          color={categoryColors[cat.category] || "gray"}
                        />
                      </Stack>
                    );
                  })}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed" ta="center" py="xl">
                  No sales data yet
                </Text>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      <Grid>
        {/* Top Products */}
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Top Selling Products</Text>
                <ActionButton
                  size="xs"
                  variant="subtle"
                  rightSection={<IconArrowRight size={14} />}
                  onClick={() => router.go("adminProducts", {})}
                >
                  View All
                </ActionButton>
              </Group>
              {productSales.length > 0 ? (
                <Table striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Product</Table.Th>
                      <Table.Th style={{ textAlign: "center" }}>Sold</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>
                        Revenue
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {productSales.map((product, index) => (
                      <Table.Tr key={product.productId}>
                        <Table.Td>
                          <Group gap="xs">
                            <Text size="sm" c="dimmed" w={20}>
                              #{index + 1}
                            </Text>
                            <Stack gap={0}>
                              <Text size="sm" fw={500}>
                                {product.productName}
                              </Text>
                              <Text size="xs" c="dimmed" ff="monospace">
                                {product.productSku}
                              </Text>
                            </Stack>
                          </Group>
                        </Table.Td>
                        <Table.Td style={{ textAlign: "center" }}>
                          <Badge size="sm" variant="light">
                            {product.totalQuantity}
                          </Badge>
                        </Table.Td>
                        <Table.Td style={{ textAlign: "right" }}>
                          <Text size="sm" fw={500} ff="monospace">
                            EUR {product.totalRevenue.toFixed(2)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <Text size="sm" c="dimmed" ta="center" py="xl">
                  No product sales yet
                </Text>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Recent Orders */}
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Recent Orders</Text>
                <ActionButton
                  size="xs"
                  variant="subtle"
                  rightSection={<IconArrowRight size={14} />}
                  onClick={() => router.go("adminOrders", {})}
                >
                  View All
                </ActionButton>
              </Group>
              {recentOrders.length > 0 ? (
                <Stack gap="sm">
                  {recentOrders.map((order) => (
                    <Group
                      key={order.id}
                      justify="space-between"
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        router.go("adminOrderDetails", {
                          params: { orderId: order.id },
                        })
                      }
                    >
                      <Stack gap={0}>
                        <Text size="sm" fw={500} ff="monospace">
                          {order.orderNumber}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {order.customerName || "Guest"} &bull;{" "}
                          {l(order.createdAt, { date: "fromNow" })}
                        </Text>
                      </Stack>
                      <Group gap="xs">
                        <Badge
                          size="xs"
                          variant="light"
                          color={statusColors[order.status] || "gray"}
                        >
                          {order.status}
                        </Badge>
                        <Text size="sm" fw={500} ff="monospace">
                          EUR {order.total.toFixed(2)}
                        </Text>
                      </Group>
                    </Group>
                  ))}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed" ta="center" py="xl">
                  No orders yet
                </Text>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Flex>
  );
};

export default AdminProductSales;
