import { $atom, type Infer, z } from "alepha";

/**
 * The seller's legal identity, as it must appear on every invoice.
 *
 * These are not decorative fields. A French B2C invoice is invalid without the
 * seller's name, address and SIRET; `vatNumber` is required once the seller is
 * liable for VAT, and `vatExemptionNotice` replaces the tax lines when they are
 * not — a micro-entreprise under the franchise must print
 * "TVA non applicable, art. 293 B du CGI" and charge no tax.
 *
 * An atom rather than a database row: it is deployment configuration, it changes
 * about once a decade, and putting it in a table invites someone to edit it and
 * silently alter what past invoices claim. Invoices freeze their own copy anyway.
 */
export const sellerIdentityAtom = $atom({
  name: "alepha.commerce.invoicing.seller",
  schema: z.object({
    name: z.text({ maxLength: 200 }).describe("Registered business name"),
    address: z.text({ maxLength: 400 }).describe("Registered address"),
    /** SIRET in France; the local company register number elsewhere. */
    registrationNumber: z
      .text({ maxLength: 64 })
      .describe("SIRET or equivalent company registration number"),
    legalForm: z
      .text({ maxLength: 64 })
      .optional()
      .describe("e.g. SASU, EURL, micro-entreprise"),
    vatNumber: z
      .text({ maxLength: 32 })
      .optional()
      .describe("Intra-community VAT number, when liable"),
    email: z.text({ maxLength: 320 }).optional(),
    phone: z.text({ maxLength: 32 }).optional(),
    /**
     * Printed instead of tax lines when the seller charges no VAT. Setting this
     * is what makes {@link InvoiceService} issue a zero-tax invoice.
     */
    vatExemptionNotice: z
      .text({ maxLength: 200 })
      .optional()
      .describe("e.g. 'TVA non applicable, art. 293 B du CGI'"),
    /** Prefix of the invoice number. */
    numberPrefix: z.text({ maxLength: 8 }).default("FA"),
  }),
  default: {
    name: "Unnamed seller",
    address: "Unknown address",
    registrationNumber: "000 000 000 00000",
    numberPrefix: "FA",
  },
  serverOnly: true,
});

export type SellerIdentity = Infer<typeof sellerIdentityAtom.schema>;

declare module "alepha" {
  interface State {
    [sellerIdentityAtom.key]: SellerIdentity;
  }
}
