import { useClient, useRouter } from "@alepha/react";
import { useI18n } from "@alepha/react/i18n";
import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge, Group } from "@mantine/core";
import { IconCreditCard } from "@tabler/icons-react";
import { type Page, t } from "alepha";
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

const methodIcons: Record<string, string> = {
  card: "Card",
  paypal: "PayPal",
  bank_transfer: "Bank",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
};

const AdminPayments = () => {
  const client = useClient<PaymentController>();
  const router = useRouter<AppRouter>();
  const { l } = useI18n();

  const filters = t.object({
    query: t.optional(t.text()),
    status: t.optional(
      t.enum(["pending", "processing", "completed", "failed", "refunded"]),
    ),
    method: t.optional(
      t.enum(["card", "paypal", "bank_transfer", "apple_pay", "google_pay"]),
    ),
  });

  return (
    <Flex flex={1} direction="column">
      <DataTable<Payment, typeof filters>
        submitOnInit
        defaultSize={10}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 3,
        }}
        tableProps={{
          horizontalSpacing: "xs",
          verticalSpacing: "xs",
          striped: false,
          highlightOnHover: true,
        }}
        onFilterChange={(key, value, form) => {
          if (key === "query" || key === "status" || key === "method") {
            return form.submit();
          }
        }}
        filters={filters}
        tableTrProps={(item) => ({
          style: { cursor: "pointer" },
          onClick: () =>
            router.go("adminPaymentDetails", {
              params: { paymentId: item.id },
            }),
        })}
        items={async (filters) => {
          const response = await client.findPayments({
            query: filters,
          });
          return response as Page<Payment>;
        }}
        columns={{
          bookingReference: {
            label: "Booking",
            fit: true,
            value: (item) => (
              <Text size="sm" fw={600} ff="monospace">
                {item.bookingReference}
              </Text>
            ),
          },
          amount: {
            label: "Amount",
            fit: true,
            value: (item) => (
              <Text size="sm" fw={600}>
                {item.currency === "EUR" ? "€" : item.currency}{" "}
                {item.amount.toFixed(2)}
              </Text>
            ),
          },
          method: {
            label: "Method",
            fit: true,
            value: (item) => (
              <Group gap="xs" wrap="nowrap">
                <IconCreditCard size={14} />
                <Text size="sm">
                  {methodIcons[item.method] || item.method}
                  {item.cardLast4 && (
                    <Text span c="dimmed" size="xs">
                      {" "}
                      •••• {item.cardLast4}
                    </Text>
                  )}
                </Text>
              </Group>
            ),
          },
          payerEmail: {
            label: "Payer",
            value: (item) => (
              <Text size="sm" c="dimmed">
                {item.payerEmail}
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
    </Flex>
  );
};

export default AdminPayments;
