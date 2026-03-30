import type { DetailListItem } from "@alepha/ui";
import {
  ActionButton,
  DataTable,
  DetailList,
  Flex,
  Section,
  Text,
  useDialog,
  useToast,
} from "@alepha/ui";
import { Badge, Code } from "@mantine/core";
import {
  IconBan,
  IconReceiptRefund,
  IconShieldCheck,
} from "@tabler/icons-react";
import { type Page, t } from "alepha";
import type {
  AdminBillingController,
  PaymentIntentEntity,
} from "alepha/billing";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
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

const formatAmount = (amount: number, currency: string): string =>
  `${currency.toUpperCase()} ${(amount / 100).toFixed(2)}`;

// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// IntentDetailContent
// ─────────────────────────────────────────────────────────────────────────────

const IntentDetailContent = (props: {
  item: PaymentIntentEntity;
  onAction: () => void;
}) => {
  const client = useClient<AdminBillingController>();
  const { l } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [intent, setIntent] = useState(props.item);

  const reload = useCallback(async () => {
    const data = await client.getIntent({ params: { id: intent.id } });
    setIntent(data);
  }, [client, intent.id]);

  const handleCapture = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: "Capture Payment",
      message: `Capture ${formatAmount(intent.amount, intent.currency)}?`,
      confirmLabel: "Capture",
      confirmColor: "green",
    });
    if (!confirmed) return;
    try {
      await client.captureIntent({
        params: { id: intent.id },
        body: {},
      });
      toast.success("Payment captured");
      reload();
      props.onAction();
    } catch {
      toast.danger("Failed to capture payment");
    }
  }, [client, dialog, intent, toast, reload, props]);

  const handleVoid = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: "Void Payment",
      message: "Void this authorized payment? This cannot be undone.",
      confirmLabel: "Void",
      confirmColor: "orange",
    });
    if (!confirmed) return;
    try {
      await client.voidIntent({ params: { id: intent.id } });
      toast.success("Payment voided");
      reload();
      props.onAction();
    } catch {
      toast.danger("Failed to void payment");
    }
  }, [client, dialog, intent, toast, reload, props]);

  const handleRefund = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: "Refund Payment",
      message: `Refund ${formatAmount(intent.amount, intent.currency)}?`,
      confirmLabel: "Refund",
      confirmColor: "violet",
    });
    if (!confirmed) return;
    try {
      await client.refundIntent({
        params: { id: intent.id },
        body: { amount: intent.amount },
      });
      toast.success("Payment refunded");
      reload();
      props.onAction();
    } catch {
      toast.danger("Failed to refund payment");
    }
  }, [client, dialog, intent, toast, reload, props]);

  const handleCancel = useCallback(async () => {
    const confirmed = await dialog.confirm({
      title: "Cancel Intent",
      message: "Cancel this payment intent?",
      confirmLabel: "Cancel",
      confirmColor: "red",
    });
    if (!confirmed) return;
    try {
      await client.cancelIntent({ params: { id: intent.id } });
      toast.success("Intent cancelled");
      reload();
      props.onAction();
    } catch {
      toast.danger("Failed to cancel intent");
    }
  }, [client, dialog, intent, toast, reload, props]);

  const detailItems: DetailListItem[] = [
    {
      label: "ID",
      value: (
        <Text size="sm" ff="monospace">
          {intent.id}
        </Text>
      ),
      copyable: intent.id,
    },
    {
      label: "Status",
      value: (
        <Badge size="sm" variant="light" color={STATUS_COLORS[intent.status]}>
          {intent.status}
        </Badge>
      ),
    },
    {
      label: "Amount",
      value: (
        <Text size="sm" fw={600}>
          {formatAmount(intent.amount, intent.currency)}
        </Text>
      ),
    },
    {
      label: "Provider Ref",
      value: (
        <Text size="sm" ff="monospace">
          {intent.providerRef}
        </Text>
      ),
      copyable: intent.providerRef ?? undefined,
      hidden: !intent.providerRef,
    },
    {
      label: "User ID",
      value: (
        <Text size="sm" ff="monospace">
          {intent.userId}
        </Text>
      ),
      copyable: intent.userId ?? undefined,
      hidden: !intent.userId,
    },
    {
      label: "Payment Method",
      value: (
        <Text size="sm" ff="monospace">
          {intent.paymentMethodId}
        </Text>
      ),
      hidden: !intent.paymentMethodId,
    },
    {
      label: "Created",
      value: String(l(intent.createdAt, { date: "lll" })),
    },
    {
      label: "Updated",
      value: String(l(intent.updatedAt, { date: "lll" })),
    },
  ];

  return (
    <Flex direction="column" gap="md">
      <Flex align="center" gap="sm">
        <Text fw={600}>Payment Intent</Text>
        <Badge size="sm" variant="light" color={STATUS_COLORS[intent.status]}>
          {intent.status}
        </Badge>
      </Flex>

      {/* Actions */}
      <Flex gap="xs">
        {intent.status === "authorized" && (
          <>
            <ActionButton
              tooltip="Capture"
              variant="light"
              size="xs"
              color="green"
              icon={IconShieldCheck}
              onClick={handleCapture}
            />
            <ActionButton
              tooltip="Void"
              variant="light"
              size="xs"
              color="orange"
              icon={IconBan}
              onClick={handleVoid}
            />
          </>
        )}
        {intent.status === "captured" && (
          <ActionButton
            tooltip="Refund"
            variant="light"
            size="xs"
            color="violet"
            icon={IconReceiptRefund}
            onClick={handleRefund}
          />
        )}
        {intent.status === "created" && (
          <ActionButton
            tooltip="Cancel"
            variant="light"
            size="xs"
            color="red"
            icon={IconBan}
            onClick={handleCancel}
          />
        )}
      </Flex>

      <Section title="Details" p="sm">
        <DetailList items={detailItems} columns={2} />
      </Section>

      {intent.metadata && (
        <Section title="Metadata" p="sm">
          <Code block>{JSON.stringify(intent.metadata, null, 2)}</Code>
        </Section>
      )}

      {intent.providerRaw && (
        <Section title="Provider Response" p="sm">
          <Code block>{JSON.stringify(intent.providerRaw, null, 2)}</Code>
        </Section>
      )}
    </Flex>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// AdminBilling
// ─────────────────────────────────────────────────────────────────────────────

const AdminBilling = () => {
  const client = useClient<AdminBillingController>();
  const { l } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
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
        rowActions={(item) => {
          const actions = [];
          if (item.status === "authorized") {
            actions.push({
              label: "Capture",
              icon: IconShieldCheck,
              color: "green",
              onClick: async () => {
                const confirmed = await dialog.confirm({
                  title: "Capture Payment",
                  message: `Capture ${formatAmount(item.amount, item.currency)}?`,
                  confirmColor: "green",
                });
                if (!confirmed) return;
                try {
                  await client.captureIntent({
                    params: { id: item.id },
                    body: {},
                  });
                  toast.success("Payment captured");
                  refresh();
                } catch {
                  toast.danger("Failed to capture");
                }
              },
            });
            actions.push({
              label: "Void",
              icon: IconBan,
              color: "orange",
              onClick: async () => {
                const confirmed = await dialog.confirm({
                  title: "Void Payment",
                  message: "Void this authorization?",
                  confirmColor: "orange",
                });
                if (!confirmed) return;
                try {
                  await client.voidIntent({ params: { id: item.id } });
                  toast.success("Payment voided");
                  refresh();
                } catch {
                  toast.danger("Failed to void");
                }
              },
            });
          }
          if (item.status === "captured") {
            actions.push({
              label: "Refund",
              icon: IconReceiptRefund,
              color: "violet",
              onClick: async () => {
                const confirmed = await dialog.confirm({
                  title: "Refund Payment",
                  message: `Refund ${formatAmount(item.amount, item.currency)}?`,
                  confirmColor: "violet",
                });
                if (!confirmed) return;
                try {
                  await client.refundIntent({
                    params: { id: item.id },
                    body: { amount: item.amount },
                  });
                  toast.success("Payment refunded");
                  refresh();
                } catch {
                  toast.danger("Failed to refund");
                }
              },
            });
          }
          if (item.status === "created") {
            actions.push({
              label: "Cancel",
              icon: IconBan,
              color: "red",
              onClick: async () => {
                const confirmed = await dialog.confirm({
                  title: "Cancel Intent",
                  message: "Cancel this payment intent?",
                  confirmColor: "red",
                });
                if (!confirmed) return;
                try {
                  await client.cancelIntent({ params: { id: item.id } });
                  toast.success("Intent cancelled");
                  refresh();
                } catch {
                  toast.danger("Failed to cancel");
                }
              },
            });
          }
          return actions;
        }}
        drawer={(item) => (
          <IntentDetailContent item={item} onAction={refresh} />
        )}
      />
    </Flex>
  );
};

export default AdminBilling;
