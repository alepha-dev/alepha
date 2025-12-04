import { useClient, useRouterState } from "@alepha/react";
import { useForm } from "@alepha/react/form";
import { useI18n } from "@alepha/react/i18n";
import { ActionButton, Control, Flex, Text } from "@alepha/ui";
import { Card, Group, Loader, Stack } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { t } from "alepha";
import { useEffect, useState } from "react";
import type { PaymentController } from "../../../api/controllers/PaymentController.ts";
import type { Payment } from "../../../api/entities/payments.ts";

const methodLabels: Record<string, string> = {
  card: "Credit/Debit Card",
  paypal: "PayPal",
  bank_transfer: "Bank Transfer",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
};

const AdminPaymentDetails = () => {
  const state = useRouterState();
  const client = useClient<PaymentController>();
  const { l } = useI18n();
  const paymentId = state.params.paymentId as string;

  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(true);
  const [refunding, setRefunding] = useState(false);

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

  const form = useForm({
    schema: t.object({
      status: t.optional(
        t.enum(["pending", "processing", "completed", "failed", "refunded"]),
      ),
      failureReason: t.optional(t.text()),
    }),
    handler: async (data) => {
      const updated = await client.updatePayment({
        params: { id: paymentId },
        body: data,
      });
      setPayment(updated);
    },
  });

  useEffect(() => {
    if (payment) {
      form.input.status?.set(payment.status);
      form.input.failureReason?.set(payment.failureReason ?? "");
    }
  }, [payment]);

  const handleRefund = async () => {
    if (!confirm("Are you sure you want to refund this payment?")) {
      return;
    }
    setRefunding(true);
    try {
      const updated = await client.refundPayment({
        params: { id: paymentId },
        body: {},
      });
      setPayment(updated);
    } finally {
      setRefunding(false);
    }
  };

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

  return (
    <Flex flex={1} direction="column" gap="md">
      <Card withBorder p="lg">
        <Stack gap="md">
          <Text size="lg" fw={500}>
            Payment Details
          </Text>

          <Group gap="xl" wrap="wrap">
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Payment ID
              </Text>
              <Text size="sm" ff="monospace">
                {payment.id}
              </Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Booking ID
              </Text>
              <Text size="sm" ff="monospace">
                {payment.bookingId}
              </Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Booking Reference
              </Text>
              <Text size="sm" fw={600} ff="monospace">
                {payment.bookingReference}
              </Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Transaction ID
              </Text>
              <Text size="sm" ff="monospace">
                {payment.transactionId || "-"}
              </Text>
            </Stack>
          </Group>
        </Stack>
      </Card>

      <Card withBorder p="lg">
        <Stack gap="md">
          <Text size="lg" fw={500}>
            Payment Method
          </Text>

          <Group gap="xl" wrap="wrap">
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Method
              </Text>
              <Text size="sm">
                {methodLabels[payment.method] || payment.method}
              </Text>
            </Stack>

            {payment.cardBrand && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Card Brand
                </Text>
                <Text size="sm">{payment.cardBrand}</Text>
              </Stack>
            )}

            {payment.cardLast4 && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Card Number
                </Text>
                <Text size="sm" ff="monospace">
                  •••• •••• •••• {payment.cardLast4}
                </Text>
              </Stack>
            )}

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Payer Email
              </Text>
              <Text size="sm">{payment.payerEmail}</Text>
            </Stack>
          </Group>
        </Stack>
      </Card>

      <Card withBorder p="lg">
        <Stack gap="md">
          <Text size="lg" fw={500}>
            Amount
          </Text>

          <Group gap="xl">
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Amount
              </Text>
              <Text size="lg" fw={600}>
                {payment.currency === "EUR" ? "€" : payment.currency}{" "}
                {payment.amount.toFixed(2)}
              </Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Currency
              </Text>
              <Text size="sm">{payment.currency}</Text>
            </Stack>

            {payment.refundAmount && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Refund Amount
                </Text>
                <Text size="sm" c="red">
                  -{payment.currency === "EUR" ? "€" : payment.currency}{" "}
                  {payment.refundAmount.toFixed(2)}
                </Text>
              </Stack>
            )}

            {payment.refundedAt && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Refunded At
                </Text>
                <Text size="sm">
                  {l(payment.refundedAt, { date: "medium" })}
                </Text>
              </Stack>
            )}

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Created
              </Text>
              <Text size="sm">{l(payment.createdAt, { date: "medium" })}</Text>
            </Stack>

            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Updated
              </Text>
              <Text size="sm">{l(payment.updatedAt, { date: "medium" })}</Text>
            </Stack>
          </Group>
        </Stack>
      </Card>

      {payment.failureReason && (
        <Card withBorder p="lg" bg="red.0">
          <Stack gap="sm">
            <Text size="lg" fw={500} c="red">
              Failure Reason
            </Text>
            <Text size="sm">{payment.failureReason}</Text>
          </Stack>
        </Card>
      )}

      <Card withBorder p="lg">
        <form {...form.props}>
          <Stack gap="md">
            <Text size="lg" fw={500}>
              Update Payment
            </Text>

            <Group grow>
              <Control title="Status" input={form.input.status} />
              <Control
                title="Failure Reason"
                input={form.input.failureReason}
              />
            </Group>

            <Group>
              <ActionButton form={form}>Save Changes</ActionButton>
              {payment.status === "completed" && (
                <ActionButton
                  color="grape"
                  variant="light"
                  leftSection={<IconRefresh size={16} />}
                  onClick={handleRefund}
                  loading={refunding}
                >
                  Refund Payment
                </ActionButton>
              )}
            </Group>
          </Stack>
        </form>
      </Card>
    </Flex>
  );
};

export default AdminPaymentDetails;
