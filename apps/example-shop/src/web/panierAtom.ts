import { $atom, type Infer, z } from "alepha";

/**
 * The cart as the browser knows it.
 *
 * A shared atom rather than a React context, per the framework's convention:
 * every component that needs the cart reads the same store, and the header's
 * count stays in step with the cart page without either knowing about the other.
 *
 * The server remains the authority — this is a mirror of the last response from
 * `/api/commerce/cart`, refreshed by whoever mutates it.
 */
export const panierAtom = $atom({
  name: "shop.panier",
  schema: z.object({
    cartId: z.uuid().optional(),
    lines: z
      .array(
        z.object({
          productId: z.uuid(),
          name: z.text(),
          kind: z.text(),
          unitPrice: z.integer(),
          quantity: z.integer(),
          lineTotal: z.integer(),
          image: z.text().optional(),
        }),
      )
      .default([]),
    subtotal: z.integer().default(0),
    currency: z.text().default("EUR"),
  }),
  default: { lines: [], subtotal: 0, currency: "EUR" },
});

export type Panier = Infer<typeof panierAtom.schema>;

declare module "alepha" {
  interface State {
    [panierAtom.key]: Panier;
  }
}
