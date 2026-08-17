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
 * sign arrives — only `adjustment` may subtract.
 */
export const stockAdjustSchema = (tr: TrFunction) =>
  z.object({
    quantity: z
      .integer()
      .min(-100000)
      .max(100000)
      .meta({
        title: String(
          tr("commerce.admin.stock.fQuantity", { default: "Quantity" }),
        ),
        $control: { width: 30 },
      }),
    reason: z.enum(["intake", "return", "adjustment"]).meta({
      title: String(tr("commerce.admin.stock.fReason", { default: "Reason" })),
      $control: {
        width: 30,
        items: [
          {
            value: "intake",
            label: String(
              tr("commerce.admin.stock.reasonIntake", { default: "Intake" }),
            ),
          },
          {
            value: "return",
            label: String(
              tr("commerce.admin.stock.reasonReturn", { default: "Return" }),
            ),
          },
          {
            value: "adjustment",
            label: String(
              tr("commerce.admin.stock.reasonAdjustment", {
                default: "Adjustment",
              }),
            ),
          },
        ],
      },
    }),
    note: z
      .text({ maxLength: 500 })
      .meta({
        title: String(tr("commerce.admin.stock.fNote", { default: "Note" })),
        $control: { width: 40 },
      })
      .optional(),
  });
