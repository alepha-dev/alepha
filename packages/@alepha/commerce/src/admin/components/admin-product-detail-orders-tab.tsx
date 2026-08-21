import * as React from "react";

void React;

import {
  AlephaTable,
  type TableFetcher,
} from "@alepha/ui/components/alepha-table/alepha-table";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import type { AdminProductOrderLine } from "../controllers/AdminProductController.ts";

export interface AdminProductDetailOrdersTabProps {
  productId: string;
  fetch: TableFetcher<AdminProductOrderLine>;
}

/**
 * What this product has actually sold.
 *
 * Lines rather than orders: one order can hold the same product twice at
 * different prices, and each line carries the price it was sold at — a
 * snapshot, deliberately, so editing the catalogue never rewrites history.
 * That is why the amounts here can disagree with the product's current price,
 * and why they should.
 */
export const AdminProductDetailOrdersTab = (
  props: AdminProductDetailOrdersTabProps,
) => {
  const { tr, l } = useI18n();

  const money = (cents: number, currency?: string) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "EUR",
    }).format((cents ?? 0) / 100);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
      <AlephaTable<AdminProductOrderLine>
        className="min-h-0 flex-1"
        persistenceKey={`commerce.admin.product.${props.productId}.orders`}
        fetch={props.fetch}
        emptyMessage={String(
          tr("commerce.admin.orders.empty", {
            default: "This product has never been ordered.",
          }),
        )}
        columns={{
          orderCreatedAt: {
            label: tr("commerce.admin.orders.colWhen", { default: "Date" }),
            cell: (line) => (
              <span className="text-muted-foreground text-xs">
                {line.orderCreatedAt
                  ? String(l(line.orderCreatedAt, { date: "lll" }))
                  : ""}
              </span>
            ),
          },
          orderId: {
            label: tr("commerce.admin.orders.colOrder", { default: "Order" }),
            cell: (line) => (
              <code className="text-xs">#{line.orderId.slice(0, 8)}</code>
            ),
          },
          orderStatus: {
            label: tr("commerce.admin.orders.colStatus", { default: "Status" }),
            cell: (line) =>
              line.orderStatus ? (
                <Badge variant="outline">{line.orderStatus}</Badge>
              ) : null,
          },
          quantity: {
            label: tr("commerce.admin.orders.colQuantity", {
              default: "Qty",
            }),
            align: "right",
            cell: (line) => (
              <span className="tabular-nums">{line.quantity}</span>
            ),
          },
          unitPrice: {
            label: tr("commerce.admin.orders.colUnitPrice", {
              default: "Unit price",
            }),
            align: "right",
            cell: (line) => (
              <span className="tabular-nums">
                {money(line.unitPrice, line.orderCurrency)}
              </span>
            ),
          },
          total: {
            label: tr("commerce.admin.orders.colTotal", { default: "Total" }),
            align: "right",
            cell: (line) => (
              <span className="font-medium tabular-nums">
                {money(line.unitPrice * line.quantity, line.orderCurrency)}
              </span>
            ),
          },
        }}
      />
    </div>
  );
};
