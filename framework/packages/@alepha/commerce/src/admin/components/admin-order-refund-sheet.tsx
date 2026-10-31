import * as React from "react";

void React;

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@alepha/ui";
import { AutoForm } from "@alepha/ui/form";
import { z } from "alepha";
import { useClient, useQuery } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";

import type { OrderEntity } from "../../entities/orders.ts";
import type { AdminOrderController } from "../controllers/AdminOrderController.ts";

export interface AdminOrderRefundSheetProps {
  order: OrderEntity;
  onClose: () => void;
  onRefunded: () => void;
}

const formatPrice = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    cents / 100,
  );

/**
 * Give money back: some lines, an amount, or everything left.
 *
 * Lines win over the amount, and with neither it refunds what is left, which is
 * stated at the top because that amount is the fact being agreed to. A credit
 * note follows by itself, for what was actually refunded.
 */
export const AdminOrderRefundSheet = (props: AdminOrderRefundSheetProps) => {
  const { order, onClose, onRefunded } = props;
  const client = useClient<AdminOrderController>();
  const { tr } = useI18n();

  const detail = useQuery(
    {
      handler: () =>
        client.commerceAdminOrderDetail({ params: { id: order.id } }),
    },
    [client, order.id],
  );

  const left = order.total - order.refundedTotal;
  const items = (detail.data?.items ?? []).filter(
    (it) => it.quantity > it.refundedQuantity,
  );
  const itemsKey = items.map((it) => it.id).join(",");

  const schema = useMemo(
    () =>
      z.object({
        ...Object.fromEntries(
          items.map((item) => [
            `line_${item.id}`,
            z
              .integer()
              .min(0)
              .max(item.quantity - item.refundedQuantity)
              .meta({
                title: item.variantLabel
                  ? `${item.name} (${item.variantLabel})`
                  : item.name,
                $control: { width: 50 },
              })
              .optional(),
          ]),
        ),
        amount: z
          .integer()
          .min(1)
          .max(left)
          .meta({
            title: tr("commerce.admin.refundSheet.fAmount", {
              default: "Amount (cents)",
            }),
            description: tr("commerce.admin.refundSheet.fAmountHint", {
              default:
                "Ignored when quantities are set. Empty: everything left.",
            }),
            $control: { width: 50 },
          })
          .optional(),
        reason: z
          .text({ maxLength: 500 })
          .meta({
            title: tr("commerce.admin.refundSheet.fReason", {
              default: "Reason",
            }),
            description: tr("commerce.admin.refundSheet.fReasonHint", {
              default: "Printed on the credit note.",
            }),
          })
          .optional(),
      }),
    [tr, itemsKey, left],
  );

  const form = useForm(
    {
      schema,
      initialValues: {},
      handler: async (values: Record<string, any>) => {
        const lines = items
          .map((item) => ({
            orderItemId: item.id,
            quantity: Number(values[`line_${item.id}`] ?? 0),
          }))
          .filter((line) => line.quantity > 0);

        await client.commerceAdminOrderRefund({
          params: { id: order.id },
          body: {
            ...(lines.length > 0
              ? { lines }
              : values.amount
                ? { amount: values.amount }
                : {}),
            ...(values.reason ? { reason: values.reason } : {}),
          },
        });
        onRefunded();
      },
    },
    [schema],
  );

  return (
    <Sheet
      open
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {tr("commerce.admin.refundTitle", { default: "Refund" })}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <p className="text-muted-foreground text-sm">
            {tr("commerce.admin.refundConfirm", {
              default: `Refund ${formatPrice(left, order.currency)} to the customer? The money goes back to them. Stock is released only if the order has not shipped. A credit note is issued.`,
              args: [formatPrice(left, order.currency)],
            })}
          </p>
          {/*
            Not before the lines are in: they are fields, so the form is built
            again when they land, and what was typed by then would be lost and
            the whole order refunded.
          */}
          {detail.data ? (
            <AutoForm
              form={form}
              submitLabel={tr("commerce.admin.refund", { default: "Refund" })}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
};
