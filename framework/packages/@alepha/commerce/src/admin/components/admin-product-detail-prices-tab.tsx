import * as React from "react";

void React;

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui";
import { useConfirmedAction } from "@alepha/ui/admin";
import { AutoForm } from "@alepha/ui/form";
import { z } from "alepha";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { Trash2 } from "lucide-react";
import { useMemo } from "react";

import type { ProductPriceEntity } from "../../entities/productPrices.ts";
import type {
  AdminProductController,
  AdminProductResource,
  AdminVariantResource,
} from "../controllers/AdminProductController.ts";

export interface AdminProductDetailPricesTabProps {
  product: AdminProductResource;
  variants: AdminVariantResource[];
  /**
   * What the shop sells in.
   */
  currencies: string[];
  prices: ProductPriceEntity[];
  /**
   * A price was set or taken off.
   */
  onChanged: () => void;
}

const formatPrice = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    cents / 100,
  );

const variantLabel = (variant: AdminVariantResource) =>
  Object.values(variant.options as Record<string, string>).join(" / ");

/**
 * What a product sells for in the shop's other currencies. Its own price stays
 * on the Overview tab, and a currency left out here is one it does not sell in.
 */
export const AdminProductDetailPricesTab = (
  props: AdminProductDetailPricesTabProps,
) => {
  const { product, variants, currencies, prices, onChanged } = props;
  const client = useClient<AdminProductController>();
  const { tr } = useI18n();

  const others = currencies.filter((it) => it !== product.currency);
  // By value, for the reason `variantsKey` is on the product page: these arrays
  // are new on every render, and a new schema rebuilds the form.
  const othersKey = others.join(",");
  const variantsKey = variants.map((it) => it.id).join(",");

  const schema = useMemo(
    () =>
      z.object({
        currency: z.text({ minLength: 3, maxLength: 3 }).meta({
          title: tr("commerce.admin.prices.fCurrency", {
            default: "Currency",
          }),
          $control: {
            width: 33,
            items: others.map((code) => ({ value: code, label: code })),
          },
        }),
        price: z
          .integer()
          .min(0)
          .meta({
            title: tr("commerce.admin.prices.fPrice", {
              default: "Price incl. tax (cents)",
            }),
            $control: { width: 33 },
          }),
        ...(variants.length > 0
          ? {
              variantId: z
                .uuid()
                .meta({
                  title: tr("commerce.admin.prices.fVariant", {
                    default: "Variant",
                  }),
                  description: tr("commerce.admin.prices.fVariantHint", {
                    default:
                      "Leave empty for the product. A variant with a price of its own needs its own row.",
                  }),
                  $control: {
                    width: 33,
                    items: variants.map((variant) => ({
                      value: variant.id,
                      label: variantLabel(variant),
                    })),
                  },
                })
                .optional(),
            }
          : {}),
      }),
    [tr, othersKey, variantsKey],
  );

  const form = useForm(
    {
      schema,
      initialValues: { currency: others[0] ?? "", price: 0 },
      handler: async (values) => {
        await client.commerceAdminProductPriceSet({
          params: { id: product.id },
          body: {
            currency: values.currency,
            price: values.price,
            variantId: values.variantId as string | undefined,
          },
        });
        onChanged();
      },
    },
    [schema, product.id],
  );

  const remove = useConfirmedAction<[ProductPriceEntity]>(
    {
      confirm: (price) => ({
        title: tr("commerce.admin.prices.removeTitle", {
          default: "Take this price off",
        }),
        description: tr("commerce.admin.prices.removeConfirm", {
          default: `The product stops selling in ${price.currency}. Carts holding it lose the line.`,
          args: [price.currency],
        }),
        destructive: true,
      }),
      handler: async (price) => {
        await client.commerceAdminProductPriceRemove({
          params: { id: product.id },
          body: {
            currency: price.currency,
            variantId: price.variantKey || undefined,
          },
        });
        onChanged();
      },
    },
    [client, product.id],
  );

  const labelOf = (price: ProductPriceEntity) => {
    const variant = variants.find((it) => it.id === price.variantKey);
    return variant
      ? variantLabel(variant)
      : tr("commerce.admin.prices.wholeProduct", { default: "The product" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {tr("commerce.admin.prices.title", {
              default: "Prices in other currencies",
            })}
          </CardTitle>
          <CardDescription>
            {tr("commerce.admin.prices.hint", {
              default:
                "Written by hand, never converted. A currency with no price here is one this product does not sell in.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <AutoForm
            form={form}
            submitLabel={tr("commerce.admin.prices.set", {
              default: "Set the price",
            })}
          />
          {prices.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {tr("commerce.admin.prices.empty", {
                default: `Sold in ${product.currency} only.`,
                args: [product.currency],
              })}
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {prices.map((price) => (
                <li
                  key={price.id}
                  className="flex items-center justify-between gap-4 py-2 text-sm"
                >
                  <span className="font-medium">{labelOf(price)}</span>
                  <span className="flex items-center gap-4">
                    <span className="tabular-nums">
                      {formatPrice(price.price, price.currency)}
                    </span>
                    <Button
                      variant="minimal"
                      size="sm"
                      aria-label={tr("commerce.admin.prices.remove", {
                        default: "Take off",
                      })}
                      disabled={remove.loading}
                      onClick={() => void remove.run(price)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
