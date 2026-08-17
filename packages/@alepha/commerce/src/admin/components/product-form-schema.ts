import { z } from "alepha";
import type { I18nProvider } from "alepha/react/i18n";

/**
 * `useI18n().tr`. Taken off the provider rather than restated, so a change to
 * its signature is a compile error here instead of a silent mismatch.
 */
type TrFunction = I18nProvider<any, any>["tr"];

/**
 * The product editor's schema.
 *
 * Built per render rather than declared at module scope because both its
 * labels and its kind list come from runtime data — the translation catalogue
 * and `ProductKindRegistry`. Callers must memoise it (`useMemo`) so `useForm`
 * does not re-anchor every render.
 *
 * ### What changed, and why it matters
 *
 * The drawer this replaces offered six fields. `currency` and `vatRateBps` are
 * new here, and `vatRateBps` was not even accepted by the API — see the note on
 * it in `AdminProductController`. Without them a catalogue could only ever be
 * single-currency and single-rate, whatever the entity claimed.
 *
 * `images`, `attributes` and `config` deliberately stay out: they have their
 * own tabs, because an upload grid and a key/value editor are not form fields.
 */
/**
 * Offered in the currency picker. Not an exhaustive ISO-4217 list — a picker
 * with 180 entries is worse than one with eight, and the caller merges in
 * whatever the product is already priced in so an unusual currency already set
 * never silently disappears from its own form.
 */
const COMMON_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "CAD",
  "AUD",
  "JPY",
  "SEK",
];

export const productFormSchema = (
  tr: TrFunction,
  kinds: string[],
  currentCurrency?: string,
) => {
  const currencies = [
    ...new Set([
      ...COMMON_CURRENCIES,
      ...(currentCurrency ? [currentCurrency] : []),
    ]),
  ].sort();

  return z.object({
    /*
     * No `minLength`, even though the API requires one.
     *
     * `useForm` decodes `initialValues` against this schema the moment it is
     * constructed, and a detail page's first render happens before its product
     * has loaded — so the fields are empty strings and a `minLength: 1` here
     * throws `SchemaValidationError` out of a `useMemo`, taking the whole page
     * to the error boundary. It is not a validation failure the user could
     * ever see or fix; the page simply never renders.
     *
     * Emptiness is guarded in the submit handler instead, which is the same
     * split `AdminUserDetail` uses and for the same reason.
     */
    name: z.text({ maxLength: 200 }).meta({
      title: String(tr("commerce.admin.fName", { default: "Name" })),
      $control: { width: 60 },
    }),
    slug: z.text({ maxLength: 200 }).meta({
      title: String(tr("commerce.admin.fSlug", { default: "Reference" })),
      description: String(
        tr("commerce.admin.fSlugHint", {
          default:
            "Appears in the URL. Do not change it once the product is on sale.",
        }),
      ),
      $control: { width: 40 },
    }),
    kind: z.text({ maxLength: 64 }).meta({
      title: String(tr("commerce.admin.fKind", { default: "Type" })),
      $control: {
        width: 34,
        items: kinds.map((kind) => ({ value: kind, label: kind })),
      },
    }),
    /*
     * Cents, and labelled as cents. An operator who types 8900 and sees
     * 89,00 € in the list learns the unit once; a euro field needs a
     * conversion on both sides and is where rounding bugs come from.
     */
    price: z
      .integer()
      .min(0)
      .meta({
        title: String(
          tr("commerce.admin.fPrice", { default: "Price incl. tax (cents)" }),
        ),
        $control: { width: 33 },
      }),
    currency: z.text({ minLength: 3, maxLength: 3 }).meta({
      title: String(tr("commerce.admin.fCurrency", { default: "Currency" })),
      $control: {
        width: 33,
        items: currencies.map((code) => ({ value: code, label: code })),
      },
    }),
    /*
     * Basis points, for the same reason the price is cents: 2000 is exactly
     * 20 %, where 20.0 as a float is not exactly anything. Optional — unset
     * means the seller's default rate from `TaxService`, which is what most of
     * a catalogue wants and why this is not required.
     */
    vatRateBps: z
      .integer()
      .min(0)
      .max(10000)
      .meta({
        title: String(
          tr("commerce.admin.fVatRate", { default: "VAT rate (basis points)" }),
        ),
        description: String(
          tr("commerce.admin.fVatRateHint", {
            default:
              "2000 = 20.00 %. Leave empty to bill at the seller's default rate.",
          }),
        ),
        $control: { width: 50 },
      })
      .optional(),
    description: z
      .text({ maxLength: 4000 })
      .meta({
        title: String(
          tr("commerce.admin.fDescription", { default: "Description" }),
        ),
        $control: { width: 100, area: true },
      })
      .optional(),
    published: z.boolean().meta({
      title: String(tr("commerce.admin.fPublished", { default: "On sale" })),
      $control: { width: 100 },
    }),
  });
};
