import {
  NestedView,
  useClient,
  useRouter,
  useRouterState,
} from "@alepha/react";
import { ActionButton, Flex, Text } from "@alepha/ui";
import { Badge, Card, Group, Loader, Stack, Tabs } from "@mantine/core";
import { IconCreditCard, IconReceipt } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { PaymentController } from "../../../api/controllers/PaymentController.ts";
import type { Payment } from "../../../api/entities/payments.ts";
import type { AppRouter } from "../../AppRouter.ts";

const statusColors: Record<string, string> = {
  pending: "yellow",
  processing: "blue",
  completed: "green",
  failed: "red",
  refunded: "grape",
};

const AdminPaymentLayout = () => {
  const router = useRouter<AppRouter>();
  const state = useRouterState();
  const client = useClient<PaymentController>();
  const paymentId = state.params.paymentId as string;

  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPayment = async () => {
      try {
        const data = await client.getPayment({
          params: { id: paymentId },
        });
        setPayment(data);
      } finally {
        setLoading(false);
      }
    };

    loadPayment();
  }, [paymentId]);

  if (loading) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Loader />
      </Flex>
    );
  }

  if (!payment) {
    return (
      <Flex flex={1} justify="center" align="center">
        <Text c="dimmed">Payment not found</Text>
      </Flex>
    );
  }

  const detailsPath = router.path("adminPaymentDetails", {
    params: { paymentId },
  });

  const getActiveTab = () => {
    return "details";
  };
  const activeTab = getActiveTab();

  return (
    <Flex flex={1} direction="column" gap="md" p="md">
      <Card withBorder p="md">
        <Group justify="space-between">
          <Group>
            <IconCreditCard size={32} color="var(--mantine-color-blue-6)" />
            <Stack gap={4}>
              <Group gap="xs">
                <Text size="lg" fw={600}>
                  {payment.currency === "EUR" ? "€" : payment.currency}{" "}
                  {payment.amount.toFixed(2)}
                </Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={statusColors[payment.status] || "gray"}
                >
                  {payment.status.charAt(0).toUpperCase() +
                    payment.status.slice(1)}
                </Badge>
              </Group>
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  Booking: {payment.bookingReference}
                </Text>
                <Text size="sm" c="dimmed">
                  •
                </Text>
                <Text size="sm" c="dimmed">
                  {payment.payerEmail}
                </Text>
              </Group>
            </Stack>
          </Group>
          {payment.transactionId && (
            <Text size="xs" c="dimmed" ff="monospace">
              {payment.transactionId}
            </Text>
          )}
        </Group>
      </Card>

      <Tabs value={activeTab}>
        <Tabs.List>
          <ActionButton
            variant="subtle"
            href={detailsPath}
            leftSection={<IconReceipt size={16} />}
            c={activeTab === "details" ? undefined : "dimmed"}
            fw={activeTab === "details" ? 500 : 400}
            style={{
              borderBottom:
                activeTab === "details"
                  ? "2px solid var(--mantine-primary-color-filled)"
                  : "2px solid transparent",
              borderRadius: 0,
            }}
          >
            Details
          </ActionButton>
        </Tabs.List>
      </Tabs>

      <Flex flex={1}>
        <NestedView />
      </Flex>
    </Flex>
  );
};

export default AdminPaymentLayout;
