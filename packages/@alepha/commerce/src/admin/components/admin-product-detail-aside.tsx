import * as React from "react";

void React;

import {
  DetailAside,
  type DetailAsideRow,
} from "@alepha/ui/components/detail/detail-aside";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";

import type { AdminProductResource } from "../controllers/AdminProductController.ts";
import { productImageUrl } from "./product-image-url.ts";

export interface AdminProductDetailAsideProps {
  product: AdminProductResource;
}

/**
 * Identity panel for a product: its listing image, then the facts an operator
 * checks without opening a tab — what it is, what it costs, whether it is on
 * sale, and how many are sellable.
 *
 * Both `slug` and `id` are copyable. The slug is what a storefront URL carries
 * and what support is quoted over the phone; the id is what a log line or a
 * database query wants.
 */
export const AdminProductDetailAside = (
  props: AdminProductDetailAsideProps,
) => {
  const { tr, l } = useI18n();
  const product = props.product;

  const price = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: product.currency,
  }).format((product.price ?? 0) / 100);

  const rows: DetailAsideRow[] = [
    {
      label: String(tr("commerce.admin.detail.id", { default: "ID" })),
      copy: product.id,
    },
    {
      label: String(tr("commerce.admin.detail.slug", { default: "Reference" })),
      copy: product.slug,
    },
    {
      label: String(tr("commerce.admin.detail.kind", { default: "Type" })),
      value: (
        <Badge variant="outline" className="font-mono text-xs">
          {product.kind}
        </Badge>
      ),
    },
    {
      label: String(tr("commerce.admin.detail.price", { default: "Price" })),
      value: <span className="block tabular-nums">{price}</span>,
    },
    {
      label: String(tr("commerce.admin.detail.vat", { default: "VAT" })),
      value: (
        <span className="block tabular-nums">
          {product.vatRateBps === undefined ? (
            <span className="text-muted-foreground">
              {tr("commerce.admin.detail.vatDefault", {
                default: "Seller default",
              })}
            </span>
          ) : (
            `${(product.vatRateBps / 100).toFixed(2)} %`
          )}
        </span>
      ),
    },
    {
      label: String(tr("commerce.admin.detail.status", { default: "Status" })),
      value: product.published ? (
        <Badge>{tr("commerce.admin.online", { default: "Online" })}</Badge>
      ) : (
        <Badge variant="secondary">
          {tr("commerce.admin.draft", { default: "Draft" })}
        </Badge>
      ),
    },
    {
      /*
       * Available first, and on-hand below it. "3 in stock" is misleading when
       * two are already in somebody's checkout, and available is the number
       * that decides whether anything can still be sold.
       */
      label: String(
        tr("commerce.admin.availableLabel", { default: "Available" }),
      ),
      value: (
        <span
          className={
            product.available <= 0
              ? "text-destructive block font-medium tabular-nums"
              : "block font-medium tabular-nums"
          }
        >
          {product.available}
        </span>
      ),
    },
    {
      label: String(tr("commerce.admin.onHandLabel", { default: "On hand" })),
      value: <span className="block tabular-nums">{product.onHand}</span>,
    },
    {
      label: String(
        tr("commerce.admin.reservedLabel", { default: "Reserved" }),
      ),
      value: <span className="block tabular-nums">{product.reserved}</span>,
    },
    {
      label: String(
        tr("commerce.admin.detail.created", { default: "Created" }),
      ),
      value: (
        <span className="block">
          {String(l(product.createdAt, { date: "lll" }))}
        </span>
      ),
    },
  ];

  return (
    <DetailAside
      title={product.name}
      image={productImageUrl(product.images?.[0])}
      rows={rows}
    />
  );
};
