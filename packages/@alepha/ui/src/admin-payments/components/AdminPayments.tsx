import { DataTable, Flex, Text } from "@alepha/ui";
import { Badge } from "@mantine/core";
import { type Page, t } from "alepha";
import type {
  AdminPaymentController,
  PaymentIntentEntity,
} from "alepha/api/payments";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useState } from "react";
import AdminPaymentIntentDrawer from "./AdminPaymentIntentDrawer.tsx";

// ──────────────���────────────────────────��─────────────────────────────────────

export const STATUS_COLORS: Record<string, string> = {
  created: "gray",
  processing: "blue",
  authorized: "cyan",
  captured: "green",
  voided: "orange",
  failed: "red",
  cancelled: "yellow",
  refunded: "violet",
  expired: "dark",
};

export const formatAmount = (amount: number, currency: string): string =>
  `${currency.toUpperCase()} ${(amount / 100).toFixed(2)}`;

// ──────────���────────────────────────���─────────────────────────────────────────

const intentFilters = t.object({
  status: t.optional(
    t.enum([
      "created",
      "processing",
      "authorized",
      "captured",
      "voided",
      "failed",
      "cancelled",
      "refunded",
      "expired",
    ]),
  ),
});

// ────────��────────────────────────────────────────────────────────────────────

const AdminPayments = () => {
  const client = useClient<AdminPaymentController>();
  const { l } = useI18n();
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <Flex p="md" flex={1} direction="column" gap="md">
      <DataTable<PaymentIntentEntity, typeof intentFilters>
        key={`intents-${refreshKey}`}
        submitOnInit
        defaultSize={15}
        typeFormProps={{
          skipSubmitButton: true,
          columns: 1,
        }}
        onFilterChange={(_key, _value, form) => form.submit()}
        filters={intentFilters}
        items={async (filters) => {
          const response = await client.listIntents({
            query: filters,
          });
          return response as Page<PaymentIntentEntity>;
        }}
        columns={{
          status: {
            label: "Status",
            value: (item) => (
              <Badge
                size="sm"
                variant="light"
                color={STATUS_COLORS[item.status]}
              >
                {item.status}
              </Badge>
            ),
          },
          amount: {
            label: "Amount",
            value: (item) => (
              <Text size="sm" fw={600} ff="monospace">
                {formatAmount(item.amount, item.currency)}
              </Text>
            ),
          },
          providerRef: {
            label: "Provider Ref",
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace" lineClamp={1}>
                {item.providerRef ?? "—"}
              </Text>
            ),
          },
          userId: {
            label: "User",
            value: (item) => (
              <Text size="xs" c="dimmed" ff="monospace" lineClamp={1}>
                {item.userId ?? "—"}
              </Text>
            ),
          },
          createdAt: {
            label: "Created",
            value: (item) => (
              <Text size="xs" c="dimmed">
                {l(item.createdAt, { date: "fromNow" })}
              </Text>
            ),
          },
        }}
        drawer={(item) => (
          <AdminPaymentIntentDrawer item={item} onAction={refresh} />
        )}
      />
    </Flex>
  );
};

export default AdminPayments;
