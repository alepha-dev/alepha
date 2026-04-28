import type { DetailListItem } from "@alepha/mantine";
import {
  ActionButton,
  DetailList,
  Flex,
  Section,
  Text,
  useDialog,
  useToast,
} from "@alepha/mantine";
import { Badge, Code } from "@mantine/core";
import {
  IconBan,
  IconReceiptRefund,
  IconShieldCheck,
} from "@tabler/icons-react";
import type {
  AdminPaymentController,
  PaymentIntentEntity,
} from "alepha/api/payments";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useCallback, useState } from "react";
import { formatAmount, STATUS_COLORS } from "./AdminPayments.tsx";

// ───────���─────────────────────────────────────────────────────────────────────

export interface AdminPaymentIntentDrawerProps {
  item: PaymentIntentEntity;
  onAction: () => void;
}

const AdminPaymentIntentDrawer = (props: AdminPaymentIntentDrawerProps) => {
  const client = useClient<AdminPaymentController>();
  const { l } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [intent, setIntent] = useState(props.item);
  const onAction = props.onAction;

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
      onAction();
    } catch {
      toast.danger("Failed to capture payment");
    }
  }, [client, dialog, intent, toast, reload, onAction]);

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
      onAction();
    } catch {
      toast.danger("Failed to void payment");
    }
  }, [client, dialog, intent, toast, reload, onAction]);

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
      onAction();
    } catch {
      toast.danger("Failed to refund payment");
    }
  }, [client, dialog, intent, toast, reload, onAction]);

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
      onAction();
    } catch {
      toast.danger("Failed to cancel intent");
    }
  }, [client, dialog, intent, toast, reload, onAction]);

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

export default AdminPaymentIntentDrawer;
