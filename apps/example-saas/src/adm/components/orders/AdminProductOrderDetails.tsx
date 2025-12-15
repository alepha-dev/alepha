import { useAction, useClient, useRouter, useRouterState } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Flex, Text } from "@alepha/ui";
import {
  Badge,
  Card,
  Grid,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBan,
  IconCalendar,
  IconCheck,
  IconCreditCard,
  IconMail,
  IconRefresh,
  IconTicket,
  IconTruck,
  IconUser,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ProductOrderController } from "../../../api/orders/controllers/ProductOrderController.ts";
import type { ProductOrder } from "../../../api/orders/entities/productOrders.ts";
import type { AdmRouter } from "../../AdmRouter.ts";

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

const paymentStatusColors: Record<string, string> = {
  pending: "yellow",
  paid: "green",
  failed: "red",
  refunded: "orange",
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

const AdminProductOrderDetails = () => {
  const state = useRouterState();
  const client = useClient<ProductOrderController>();
  const router = useRouter<AdmRouter>();
  const { l } = useI18n();
  const orderId = state.params.orderId as string;

  const [order, setOrder] = useState<ProductOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelReason, setCancelReason] = useState("");
  const [refundReason, setRefundReason] = useState("");

  const [cancelOpened, { open: openCancel, close: closeCancel }] =
    useDisclosure(false);
  const [refundOpened, { open: openRefund, close: closeRefund }] =
    useDisclosure(false);

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

  useEffect(() => {
    loadOrder();
  }, [orderId]);

  const confirmPaymentAction = useAction(
    {
      handler: async () => {
        await client.confirmPayment({
          params: { id: orderId },
          body: {},
        });
        await loadOrder();
      },
    },
    [orderId],
  );

  const fulfillAction = useAction(
    {
      handler: async () => {
        await client.fulfillOrder({
          params: { id: orderId },
          body: {},
        });
        await loadOrder();
      },
    },
    [orderId],
  );

  const cancelAction = useAction(
    {
      handler: async () => {
        await client.cancelOrder({
          params: { id: orderId },
          body: { reason: cancelReason },
        });
        closeCancel();
        setCancelReason("");
        await loadOrder();
      },
    },
    [orderId, cancelReason],
  );

  const refundAction = useAction(
    {
      handler: async () => {
        await client.refundOrder({
          params: { id: orderId },
          body: { reason: refundReason },
        });
        closeRefund();
        setRefundReason("");
        await loadOrder();
      },
    },
    [orderId, refundReason],
  );

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

  const canConfirmPayment =
    order.paymentStatus === "pending" && order.status !== "cancelled";
  const canFulfill =
    order.paymentStatus === "paid" &&
    order.status !== "fulfilled" &&
    order.status !== "cancelled" &&
    order.status !== "refunded";
  const canCancel =
    order.status !== "fulfilled" &&
    order.status !== "cancelled" &&
    order.status !== "refunded";
  const canRefund =
    order.paymentStatus === "paid" && order.status !== "refunded";

  return (
    <Flex flex={1} direction="column" gap="md">
      {/* Action Buttons */}
      <Group justify="flex-end">
        {canConfirmPayment && (
          <ActionButton
            variant="subtle"
            color="green"
            leftSection={<IconCreditCard size={16} />}
            onClick={confirmPaymentAction.run}
            loading={confirmPaymentAction.loading}
          >
            Confirm Payment
          </ActionButton>
        )}
        {canFulfill && (
          <ActionButton
            variant="subtle"
            color="blue"
            leftSection={<IconCheck size={16} />}
            onClick={fulfillAction.run}
            loading={fulfillAction.loading}
          >
            Fulfill Order
          </ActionButton>
        )}
        {canCancel && (
          <ActionButton
            variant="subtle"
            color="orange"
            leftSection={<IconBan size={16} />}
            onClick={openCancel}
          >
            Cancel
          </ActionButton>
        )}
        {canRefund && (
          <ActionButton
            variant="subtle"
            color="red"
            leftSection={<IconRefresh size={16} />}
            onClick={openRefund}
          >
            Refund
          </ActionButton>
        )}
      </Group>

      <Grid>
        {/* Order Summary */}
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder h="100%">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>Order Items</Text>
                <Badge
                  size="lg"
                  variant="light"
                  color={statusColors[order.status] || "gray"}
                >
                  {statusLabels[order.status] || order.status}
                </Badge>
              </Group>

              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Product</Table.Th>
                    <Table.Th style={{ textAlign: "center" }}>Qty</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Price</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Total</Table.Th>
                    <Table.Th style={{ textAlign: "center" }}>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {order.items.map((item, index) => (
                    <Table.Tr key={index}>
                      <Table.Td>
                        <Stack gap={2}>
                          <Text size="sm" fw={500}>
                            {item.productName}
                          </Text>
                          <Group gap="xs">
                            <Text size="xs" c="dimmed" ff="monospace">
                              {item.productSku}
                            </Text>
                            <Badge size="xs" variant="outline">
                              {categoryLabels[item.category] || item.category}
                            </Badge>
                          </Group>
                        </Stack>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "center" }}>
                        <Text size="sm">{item.quantity}</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Text size="sm" ff="monospace">
                          {order.currency} {item.unitPrice.toFixed(2)}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Text size="sm" fw={500} ff="monospace">
                          {order.currency} {item.total.toFixed(2)}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "center" }}>
                        <Badge
                          size="xs"
                          variant="light"
                          color={
                            item.status === "fulfilled"
                              ? "green"
                              : item.status === "cancelled"
                                ? "gray"
                                : "yellow"
                          }
                        >
                          {item.status}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>

              {/* Totals */}
              <Stack gap="xs" align="flex-end">
                <Group gap="xl">
                  <Text size="sm" c="dimmed">
                    Subtotal
                  </Text>
                  <Text size="sm" ff="monospace">
                    {order.currency} {order.subtotal.toFixed(2)}
                  </Text>
                </Group>
                <Group gap="xl">
                  <Text size="sm" c="dimmed">
                    Tax
                  </Text>
                  <Text size="sm" ff="monospace">
                    {order.currency} {order.taxAmount.toFixed(2)}
                  </Text>
                </Group>
                {order.discountAmount > 0 && (
                  <Group gap="xl">
                    <Text size="sm" c="dimmed">
                      Discount
                    </Text>
                    <Text size="sm" ff="monospace" c="green">
                      -{order.currency} {order.discountAmount.toFixed(2)}
                    </Text>
                  </Group>
                )}
                <Group gap="xl">
                  <Text size="md" fw={600}>
                    Total
                  </Text>
                  <Text size="md" fw={600} ff="monospace">
                    {order.currency} {order.total.toFixed(2)}
                  </Text>
                </Group>
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>

        {/* Order Info */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="md">
            {/* Customer */}
            <Card withBorder>
              <Stack gap="md">
                <Text fw={600}>Customer</Text>
                <Stack gap="xs">
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="gray">
                      <IconUser size={14} />
                    </ThemeIcon>
                    <Text size="sm">{order.customerName || "Guest"}</Text>
                  </Group>
                  {order.customerEmail && (
                    <Group gap="sm">
                      <ThemeIcon size="sm" variant="light" color="gray">
                        <IconMail size={14} />
                      </ThemeIcon>
                      <Text size="sm">{order.customerEmail}</Text>
                    </Group>
                  )}
                  {order.customerId && (
                    <ActionButton
                      size="xs"
                      variant="subtle"
                      onClick={() =>
                        router.go("adminCustomerDetails", {
                          params: { customerId: order.customerId! },
                        })
                      }
                    >
                      View Customer
                    </ActionButton>
                  )}
                </Stack>
              </Stack>
            </Card>

            {/* Payment */}
            <Card withBorder>
              <Stack gap="md">
                <Group justify="space-between">
                  <Text fw={600}>Payment</Text>
                  <Badge
                    size="sm"
                    variant="light"
                    color={paymentStatusColors[order.paymentStatus] || "gray"}
                  >
                    {order.paymentStatus}
                  </Badge>
                </Group>
                <Stack gap="xs">
                  <Group gap="sm">
                    <ThemeIcon size="sm" variant="light" color="gray">
                      <IconCreditCard size={14} />
                    </ThemeIcon>
                    <Text size="sm" fw={500} ff="monospace">
                      {order.currency} {order.total.toFixed(2)}
                    </Text>
                  </Group>
                  {order.paidAt && (
                    <Group gap="sm">
                      <ThemeIcon size="sm" variant="light" color="gray">
                        <IconCalendar size={14} />
                      </ThemeIcon>
                      <Text size="sm" c="dimmed">
                        Paid {l(order.paidAt, { date: "long" })}
                      </Text>
                    </Group>
                  )}
                  {order.refundAmount && (
                    <Group gap="sm">
                      <ThemeIcon size="sm" variant="light" color="red">
                        <IconRefresh size={14} />
                      </ThemeIcon>
                      <Text size="sm" c="red">
                        Refunded: {order.currency}{" "}
                        {order.refundAmount.toFixed(2)}
                      </Text>
                    </Group>
                  )}
                  {order.voucherCode && (
                    <Group gap="sm">
                      <ThemeIcon size="sm" variant="light" color="violet">
                        <IconTicket size={14} />
                      </ThemeIcon>
                      <Text size="sm" ff="monospace">
                        {order.voucherCode}
                      </Text>
                    </Group>
                  )}
                </Stack>
              </Stack>
            </Card>

            {/* Booking Link */}
            {order.bookingId && (
              <Card withBorder>
                <Stack gap="md">
                  <Text fw={600}>Linked Booking</Text>
                  <ActionButton
                    variant="light"
                    leftSection={<IconTicket size={16} />}
                    onClick={() =>
                      router.go("adminBookingDetails", {
                        params: { bookingId: order.bookingId! },
                      })
                    }
                  >
                    View Booking
                  </ActionButton>
                </Stack>
              </Card>
            )}

            {/* Delivery */}
            {order.deliveryMethod && (
              <Card withBorder>
                <Stack gap="md">
                  <Text fw={600}>Delivery</Text>
                  <Stack gap="xs">
                    <Group gap="sm">
                      <ThemeIcon size="sm" variant="light" color="gray">
                        <IconTruck size={14} />
                      </ThemeIcon>
                      <Text size="sm" tt="capitalize">
                        {order.deliveryMethod.replace("_", " ")}
                      </Text>
                    </Group>
                    {order.deliveryLocation && (
                      <Text size="sm" c="dimmed">
                        {order.deliveryLocation}
                      </Text>
                    )}
                    {order.deliveryNotes && (
                      <Text size="sm" c="dimmed" fs="italic">
                        {order.deliveryNotes}
                      </Text>
                    )}
                  </Stack>
                </Stack>
              </Card>
            )}

            {/* Timestamps */}
            <Card withBorder>
              <Stack gap="md">
                <Text fw={600}>Timeline</Text>
                <Stack gap="xs">
                  <Group gap="sm">
                    <Text size="xs" c="dimmed" w={70}>
                      Created
                    </Text>
                    <Text size="xs">
                      {l(order.createdAt, { date: "long" })}
                    </Text>
                  </Group>
                  {order.fulfilledAt && (
                    <Group gap="sm">
                      <Text size="xs" c="dimmed" w={70}>
                        Fulfilled
                      </Text>
                      <Text size="xs">
                        {l(order.fulfilledAt, { date: "long" })}
                      </Text>
                    </Group>
                  )}
                  {order.cancelledAt && (
                    <Group gap="sm">
                      <Text size="xs" c="dimmed" w={70}>
                        Cancelled
                      </Text>
                      <Text size="xs" c="red">
                        {l(order.cancelledAt, { date: "long" })}
                      </Text>
                    </Group>
                  )}
                  {order.refundedAt && (
                    <Group gap="sm">
                      <Text size="xs" c="dimmed" w={70}>
                        Refunded
                      </Text>
                      <Text size="xs" c="orange">
                        {l(order.refundedAt, { date: "long" })}
                      </Text>
                    </Group>
                  )}
                </Stack>
              </Stack>
            </Card>

            {/* Notes */}
            {(order.notes || order.cancellationReason) && (
              <Card withBorder>
                <Stack gap="md">
                  <Text fw={600}>Notes</Text>
                  {order.notes && (
                    <Text size="sm" c="dimmed">
                      {order.notes}
                    </Text>
                  )}
                  {order.cancellationReason && (
                    <Text size="sm" c="red">
                      Cancellation: {order.cancellationReason}
                    </Text>
                  )}
                </Stack>
              </Card>
            )}
          </Stack>
        </Grid.Col>
      </Grid>

      {/* Cancel Modal */}
      <Modal opened={cancelOpened} onClose={closeCancel} title="Cancel Order">
        <Stack gap="md">
          <Textarea
            label="Cancellation Reason"
            placeholder="Enter reason for cancellation..."
            required
            value={cancelReason}
            onChange={(e) => setCancelReason(e.currentTarget.value)}
            minRows={3}
          />
          <Group justify="flex-end">
            <ActionButton variant="subtle" onClick={closeCancel}>
              Back
            </ActionButton>
            <ActionButton
              variant="filled"
              color="orange"
              onClick={cancelAction.run}
              loading={cancelAction.loading}
              disabled={!cancelReason}
            >
              Cancel Order
            </ActionButton>
          </Group>
        </Stack>
      </Modal>

      {/* Refund Modal */}
      <Modal opened={refundOpened} onClose={closeRefund} title="Refund Order">
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Refund amount: {order.currency} {order.total.toFixed(2)}
          </Text>
          <Textarea
            label="Refund Reason"
            placeholder="Enter reason for refund..."
            required
            value={refundReason}
            onChange={(e) => setRefundReason(e.currentTarget.value)}
            minRows={3}
          />
          <Group justify="flex-end">
            <ActionButton variant="subtle" onClick={closeRefund}>
              Back
            </ActionButton>
            <ActionButton
              variant="filled"
              color="red"
              onClick={refundAction.run}
              loading={refundAction.loading}
              disabled={!refundReason}
            >
              Process Refund
            </ActionButton>
          </Group>
        </Stack>
      </Modal>
    </Flex>
  );
};

export default AdminProductOrderDetails;
