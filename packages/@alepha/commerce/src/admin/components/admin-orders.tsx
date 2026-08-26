import * as React from "react";

void React;

import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { z } from "alepha";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  CheckCheck,
  CircleDot,
  PackageCheck,
  Receipt,
  Truck,
} from "lucide-react";
import { useCallback, useState } from "react";

import type { OrderEntity, OrderStatus } from "../../entities/orders.ts";
import type { AdminOrderController } from "../controllers/AdminOrderController.ts";

const formatPrice = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    (cents ?? 0) / 100,
  );

/**
 * How each status reads at a glance. `pending` and `refunded` are the two an
 * operator must spot without reading, so they carry the loud variants.
 *
 * `partially_refunded` is not one of them: the sale still stands, some money
 * went back, and the amount is on the row's total. Painting it like `refunded`
 * would recreate, in colour, exactly the confusion the status was added to
 * end.
 */
const STATUS_VARIANT: Record<
  OrderStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "outline",
  paid: "default",
  fulfilled: "secondary",
  shipped: "secondary",
  delivered: "secondary",
  cancelled: "outline",
  refunded: "destructive",
  partially_refunded: "outline",
};

const STATUSES: OrderStatus[] = [
  "pending",
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "partially_refunded",
  "refunded",
];

const filtersSchema = z.object({
  status: z.string().optional(),
});

/**
 * Order management: see them, ship them, refund them.
 *
 * Every mutating action is gated by a confirmation, and the labels say what will
 * happen rather than what the endpoint is called — "Rembourser 95,90 €", not
 * "Refund". An operator clicking through a list of orders needs the amount in the
 * dialog, because that is the fact they are agreeing to.
 */
export const AdminOrders = () => {
  const client = useClient<AdminOrderController>();
  const { l, tr } = useI18n();
  const dialog = useDialog();

  const [detailOf, setDetailOf] = useState<string>();

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: Record<string, any>;
    }) =>
      client.commerceAdminOrderList({
        query: {
          page: params.page,
          size: params.size,
          ...(params.filters?.status
            ? { status: params.filters.status as OrderStatus }
            : {}),
        },
      }),
    [client],
  );

  /**
   * Shipping asks for the tracking number, because a shipping notice without one
   * is a worse email than no email.
   */
  const ship = useCallback(
    async (order: OrderEntity, refresh: () => void) => {
      const trackingNumber = await dialog.prompt({
        title: String(
          tr("commerce.admin.shipTitle", {
            default: "Hand to the carrier",
          }),
        ),
        description: String(
          tr("commerce.admin.shipHint", {
            default:
              "Tracking number, if there is one. The customer receives it by email.",
          }),
        ),
        confirmLabel: String(
          tr("commerce.admin.shipConfirm", { default: "Ship" }),
        ),
      });
      // `undefined` is a cancel; an empty string is "no tracking number", which
      // is a legitimate answer for an in-store pickup.
      if (trackingNumber === undefined) {
        return;
      }
      await client.commerceAdminOrderShip({
        params: { id: order.id },
        body: trackingNumber ? { trackingNumber } : {},
      });
      refresh();
    },
    [client, dialog, tr],
  );

  const deliver = useConfirmedAction<[OrderEntity, () => void]>(
    {
      confirm: () => ({
        title: String(
          tr("commerce.admin.deliverTitle", { default: "Mark as received" }),
        ),
        description: String(
          tr("commerce.admin.deliverConfirm", {
            default: "Has the customer confirmed the parcel arrived?",
          }),
        ),
      }),
      handler: async (order, refresh) => {
        await client.commerceAdminOrderDeliver({ params: { id: order.id } });
        refresh();
      },
    },
    [client],
  );

  const refund = useConfirmedAction<[OrderEntity, () => void]>(
    {
      confirm: (order) => {
        // What the button will actually take back: the rest, on an order that
        // has already had part of it refunded. The amount is the fact the
        // operator is agreeing to, so it has to be the real one.
        const remaining = Math.max(0, order.total - order.refundedTotal);
        return {
          title: String(
            tr("commerce.admin.refundTitle", { default: "Refund" }),
          ),
          description: String(
            tr("commerce.admin.refundConfirm", {
              default: `Refund ${formatPrice(remaining, order.currency)} to the customer? The money goes back to them and the stock is released. A credit note is issued.`,
              args: [formatPrice(remaining, order.currency)],
            }),
          ),
          destructive: true,
        };
      },
      handler: async (order, refresh) => {
        await client.commerceAdminOrderRefund({
          params: { id: order.id },
          body: {},
        });
        refresh();
      },
      success: () =>
        String(tr("commerce.admin.refunded", { default: "Order refunded." })),
    },
    [client],
  );

  return (
    <AdminPage>
      <AlephaTable<OrderEntity>
        className="min-h-0 flex-1"
        persistenceKey="commerce.admin.orders"
        fetch={fetcher}
        onRowClick={(order) => setDetailOf(order.id)}
        emptyMessage={String(
          tr("commerce.admin.noOrders", { default: "No orders." }),
        )}
        filters={{
          schema: filtersSchema,
          // Same shape as the catalogue's kind filter — see the note there.
          render: (form) => (
            <Control
              input={form.input.status}
              label=""
              clearable
              icon={CircleDot}
              clearLabel={String(
                tr("commerce.admin.allStatuses", { default: "All statuses" }),
              )}
              triggerClassName="w-52"
              items={STATUSES.map((status) => ({
                value: status,
                label: String(
                  tr(`commerce.status.${status}`, { default: status }),
                ),
              }))}
            />
          ),
        }}
        rowActions={(order) => [
          {
            label: String(tr("commerce.admin.ship", { default: "Ship" })),
            icon: Truck,
            disabled: () => !["paid", "fulfilled"].includes(order.status),
            onClick: (item, ctx) => void ship(item, ctx.refresh),
          },
          {
            label: String(
              tr("commerce.admin.deliver", { default: "Mark received" }),
            ),
            icon: CheckCheck,
            disabled: () => order.status !== "shipped",
            onClick: (item, ctx) => void deliver.run(item, ctx.refresh),
          },
          {
            label: String(tr("commerce.admin.refund", { default: "Refund" })),
            icon: Receipt,
            destructive: true,
            disabled: () =>
              ["pending", "cancelled", "refunded"].includes(order.status),
            onClick: (item, ctx) => void refund.run(item, ctx.refresh),
          },
        ]}
        columns={{
          createdAt: {
            label: tr("commerce.admin.colWhen", { default: "Date" }),
            sortable: true,
            cell: (o) => (
              <span className="text-muted-foreground text-xs">
                {String(l(o.createdAt, { date: "lll" }))}
              </span>
            ),
          },
          status: {
            label: tr("commerce.admin.colStatus", { default: "Status" }),
            cell: (o) => (
              <Badge variant={STATUS_VARIANT[o.status] ?? "outline"}>
                {tr(`commerce.status.${o.status}`, { default: o.status })}
              </Badge>
            ),
          },
          total: {
            label: tr("commerce.admin.colTotal", { default: "Total" }),
            align: "right",
            sortable: true,
            cell: (o) => (
              <div className="flex flex-col items-end">
                <span className="font-medium tabular-nums">
                  {formatPrice(o.total, o.currency)}
                </span>
                {/*
                  What came back, where the figure it came off is. A partial
                  refund is otherwise a status and nothing else: the operator
                  can see that some money went out and not how much, which is
                  the first question they will ask.
                */}
                {o.refundedTotal > 0 ? (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {tr("commerce.admin.refundedAmount", {
                      default: "-$1 refunded",
                      args: [formatPrice(o.refundedTotal, o.currency)],
                    })}
                  </span>
                ) : null}
              </div>
            ),
          },
          shippingMethod: {
            label: tr("commerce.admin.colShipping", { default: "Shipping" }),
            cell: (o) => (
              <div className="flex flex-col">
                <span className="text-xs">{o.shippingMethod ?? "—"}</span>
                {o.trackingNumber ? (
                  <span className="text-muted-foreground font-mono text-xs">
                    {o.trackingNumber}
                  </span>
                ) : null}
              </div>
            ),
          },
        }}
      />

      {detailOf ? (
        <AdminOrderSheet
          key={detailOf}
          orderId={detailOf}
          onClose={() => setDetailOf(undefined)}
        />
      ) : null}
    </AdminPage>
  );
};

interface AdminOrderSheetProps {
  orderId: string;
  onClose: () => void;
}

/**
 * One order, in full: what was bought, where it goes, what was charged.
 *
 * A sheet rather than a route, for the same reason as the product editor — an
 * operator working through a morning's orders should not lose the list. The lines
 * come from the order's own snapshot, so an order placed a year ago still shows
 * the name and price that were agreed then.
 */
const AdminOrderSheet = (props: AdminOrderSheetProps) => {
  const { orderId, onClose } = props;
  const client = useClient<AdminOrderController>();
  const { l, tr } = useI18n();

  const { data, loading } = useQuery(
    {
      key: ["commerce", "order", orderId],
      handler: () =>
        client.commerceAdminOrderDetail({ params: { id: orderId } }),
    },
    [client, orderId],
  );

  const order = data?.order;
  const address = order?.shippingAddress as Record<string, string> | undefined;

  return (
    <Sheet
      open
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">
            {orderId.slice(0, 8).toUpperCase()}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-8 px-4 pb-8">
          {loading && !order ? (
            <p className="text-muted-foreground text-sm">
              {tr("commerce.admin.loading", { default: "Loading…" })}
            </p>
          ) : null}

          {order ? (
            <>
              <div className="flex items-center gap-3">
                <Badge variant={STATUS_VARIANT[order.status] ?? "outline"}>
                  {tr(`commerce.status.${order.status}`, {
                    default: order.status,
                  })}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {String(l(order.createdAt, { date: "lll" }))}
                </span>
              </div>

              <section>
                <h3 className="mb-3 text-xs font-medium tracking-wide uppercase">
                  {tr("commerce.admin.lines", { default: "Items" })}
                </h3>
                <ul className="divide-border divide-y">
                  {data.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-baseline justify-between gap-4 py-2 text-sm"
                    >
                      <span>
                        {item.name}
                        {item.quantity > 1 ? (
                          <span className="text-muted-foreground">
                            {" "}
                            × {item.quantity}
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums">
                        {formatPrice(
                          item.unitPrice * item.quantity,
                          order.currency,
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                <dl className="mt-4 space-y-1 text-sm">
                  {order.shippingTotal > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        {tr("commerce.admin.shippingLine", {
                          default: "Shipping",
                        })}
                        {order.shippingMethod
                          ? ` · ${order.shippingMethod}`
                          : ""}
                      </dt>
                      <dd className="tabular-nums">
                        {formatPrice(order.shippingTotal, order.currency)}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between font-medium">
                    <dt>
                      {tr("commerce.admin.colTotal", { default: "Total" })}
                    </dt>
                    <dd className="tabular-nums">
                      {formatPrice(order.total, order.currency)}
                    </dd>
                  </div>
                  <div className="text-muted-foreground flex justify-between text-xs">
                    <dt>
                      {tr("commerce.admin.vat", { default: "incl. VAT" })}
                    </dt>
                    <dd className="tabular-nums">
                      {formatPrice(order.taxTotal, order.currency)}
                    </dd>
                  </div>
                </dl>
              </section>

              {address ? (
                <section>
                  <h3 className="mb-3 text-xs font-medium tracking-wide uppercase">
                    {tr("commerce.admin.address", {
                      default: "Delivery address",
                    })}
                  </h3>
                  <address className="text-muted-foreground text-sm not-italic">
                    {address.fullName}
                    <br />
                    {address.line1}
                    {address.line2 ? (
                      <>
                        <br />
                        {address.line2}
                      </>
                    ) : null}
                    <br />
                    {address.postalCode} {address.locality}
                    <br />
                    {address.country}
                  </address>
                </section>
              ) : null}

              {order.trackingNumber ? (
                <section className="flex items-center gap-2 text-sm">
                  <PackageCheck className="size-4" />
                  <span className="font-mono">{order.trackingNumber}</span>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
};
