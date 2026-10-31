import { z } from "alepha";
import type { I18nProvider } from "alepha/react/i18n";

type TrFunction = I18nProvider<any, any>["tr"];

/**
 * The stock-correction form.
 *
 * Built per render because its labels come from the translation catalogue.
 * Callers must memoise it so `useForm` does not re-anchor every render.
 *
 * `quantity` allows negatives, which is the whole difference between this and
 * the list's one-click `+1` restock: a real correction goes both ways. The
 * server refuses zero, and treats `intake` / `return` as additions whatever
 * sign arrives - only `adjustment` may subtract.
 */
export const stockAdjustSchema = (
  tr: TrFunction,
  variants: Array<{ value: string; label: string }> = [],
) => {
  const base = z.object({
    quantity: z
      .integer()
      .min(-100000)
      .max(100000)
      .meta({
        title: tr("commerce.admin.stock.fQuantity", { default: "Quantity" }),
        $control: { width: 30 },
      }),
    reason: z.enum(["intake", "return", "adjustment"]).meta({
      title: tr("commerce.admin.stock.fReason", { default: "Reason" }),
      $control: {
        width: 30,
        items: [
          {
            value: "intake",
            label: tr("commerce.admin.stock.reasonIntake", {
              default: "Intake",
            }),
          },
          {
            value: "return",
            label: tr("commerce.admin.stock.reasonReturn", {
              default: "Return",
            }),
          },
          {
            value: "adjustment",
            label: tr("commerce.admin.stock.reasonAdjustment", {
              default: "Adjustment",
            }),
          },
        ],
      },
    }),
    note: z
      .text({ maxLength: 500 })
      .meta({
        title: tr("commerce.admin.stock.fNote", { default: "Note" }),
        $control: { width: 40 },
      })
      .optional(),
  });

  // Only on a product sold by variant, where the server refuses a movement
  // that names none. Typed as the base: what the form submits is a body, and
  // the field is optional on it.
  return (
    variants.length > 0
      ? base.extend({
          variantId: z
            .text()
            .meta({
              title: tr("commerce.admin.stock.fVariant", {
                default: "Variant",
              }),
              $control: { width: 100, items: variants },
            })
            .optional(),
        })
      : base
  ) as typeof base;
};
