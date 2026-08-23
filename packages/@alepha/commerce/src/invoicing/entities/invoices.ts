import type { Infer } from "alepha";
import { z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * An issued invoice.
 *
 * ### Why the content is frozen here and not recomputed
 *
 * An invoice is a legal record of what was billed, not a view over current data.
 * Once issued it must never change — so the seller's identity, the buyer's
 * address, every line and every tax bucket are copied in at issue time. Editing
 * a product's name a year later must not rewrite history, and a `JOIN` back to
 * `commerce_products` would do exactly that.
 *
 * Correcting an invoice therefore means issuing a credit note, which is why
 * {@link creditsInvoiceId} exists rather than an `amend()` method.
 */
export const invoices = $entity({
  name: "commerce_invoices",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    organizationId: db.organization(),

    /**
     * The legal number: gapless, sequential, per organisation and year. Unique,
     * because a duplicate is the one failure mode an auditor looks for.
     */
    number: z.text({ minLength: 1, maxLength: 40 }),

    /**
     * Year the sequence belongs to — part of the number's scope.
     */
    year: z.integer(),

    /**
     * Plain uuid: deleting an order must never delete its invoice.
     */
    orderId: z.uuid(),

    /**
     * Set on a credit note, pointing at the invoice it corrects.
     */
    creditsInvoiceId: z.uuid().optional(),

    /**
     * Why a credit note was issued. Not optional in spirit — a reversal with no
     * stated reason is what makes a ledger unauditable — but nullable because
     * ordinary invoices have nothing to explain.
     */
    note: z.text({ maxLength: 500 }).optional(),

    issuedAt: z.text(),

    /**
     * Frozen copy of the seller's legal identity.
     */
    seller: z.json(),
    /**
     * Frozen copy of the buyer's name and address.
     */
    buyer: z.json(),

    /**
     * Frozen lines.
     *
     * Spelled out rather than `z.json()` for two reasons. `z.json()` maps to a
     * *record* and rejects a top-level array outright — the first attempt here
     * failed with "expected record, received array". And since the shape has to
     * be declared anyway, declaring it properly means the frozen content is
     * validated on the way in, which is worth having for a legal record.
     */
    lines: z.array(
      z.object({
        description: z.text({ maxLength: 400 }),
        quantity: z.integer(),
        unitPrice: z.integer(),
        lineTotal: z.integer(),
        rateBps: z.integer(),
      }),
    ),

    /**
     * Frozen per-rate ventilation.
     */
    vatBuckets: z.array(
      z.object({
        rateBps: z.integer(),
        baseCents: z.integer(),
        vatCents: z.integer(),
      }),
    ),

    /**
     * Totals, in the smallest currency unit.
     */
    baseTotal: z.integer(),
    vatTotal: z.integer(),
    grandTotal: z.integer(),
    currency: z.text({ minLength: 3, maxLength: 3 }),
  }),
  indexes: [
    { columns: ["organizationId", "number"], unique: true },
    { columns: ["orderId"] },
    { columns: ["organizationId", "year"] },
  ],
});

export type InvoiceEntity = Infer<typeof invoices.schema>;

/**
 * A line as frozen onto an invoice.
 */
export interface InvoiceLine {
  description: string;
  quantity: number;
  /**
   * Tax-inclusive unit price.
   */
  unitPrice: number;
  /**
   * Tax-inclusive line total.
   */
  lineTotal: number;
  rateBps: number;
}
