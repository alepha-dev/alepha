import { useClient, useRouterState } from "@alepha/react";
import { Flex, Text } from "@alepha/ui";
import { Badge, Group, Loader, Stack } from "@mantine/core";
import { IconReceipt } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ProductOrderController } from "../../../api/orders/controllers/ProductOrderController.ts";
import type { ProductOrder } from "../../../api/orders/entities/productOrders.ts";

const statusColors: Record<string, string> = {
  pending: "yellow",
  confirmed: "blue",
  processing: "cyan",
  fulfilled: "green",
  partially_fulfilled: "teal",
  cancelled: "gray",
  refunded: "red",
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  fulfilled: "Fulfilled",
  partially_fulfilled: "Partial",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

interface AdminProductOrderLayoutProps {
  header?: boolean;
}

const AdminProductOrderLayout = ({
  header = true,
}: AdminProductOrderLayoutProps) => {
  const state = useRouterState();
  const client = useClient<ProductOrderController>();
  const orderId = state.params.orderId as string;

  const [order, setOrder] = useState<ProductOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadOrder = async () => {
      try {
        const data = await client.getOrderAdmin({
          params: { id: orderId },
        });
        setOrder(data);
      } finally {
        setLoading(false);
      }
    };

    loadOrder();
  }, [orderId]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!order) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Order not found</Text>
      </Flex>
    );
  }

  if (!header) {
    return null;
  }

  return (
    <Group gap="md">
      <IconReceipt size={24} />
      <Stack gap={0}>
        <Group gap="sm">
          <Text size="lg" fw={600} ff="monospace">
            {order.orderNumber}
          </Text>
          <Badge
            size="sm"
            variant="light"
            color={statusColors[order.status] || "gray"}
          >
            {statusLabels[order.status] || order.status}
          </Badge>
          {order.isBookingAddOn && (
            <Badge size="sm" variant="light" color="violet">
              Booking Add-on
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed">
          {order.customerName || "Guest"} &bull; {order.itemCount} item
          {order.itemCount !== 1 ? "s" : ""} &bull; {order.currency}{" "}
          {order.total.toFixed(2)}
        </Text>
      </Stack>
    </Group>
  );
};

export default AdminProductOrderLayout;
