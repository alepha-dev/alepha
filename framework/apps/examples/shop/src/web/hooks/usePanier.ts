import type { CartController } from "@alepha/commerce/cart";
import { useAction, useClient, useStore } from "alepha/react";

import { panierAtom } from "../panierAtom.ts";

/**
 * Read and mutate the cart.
 *
 * Every mutation returns the whole priced cart from the server and writes it
 * straight into the atom, so there is no client-side cart arithmetic to drift
 * from the server's. That is the same rule the domain follows — one place
 * computes a total — applied to the front end.
 *
 * Each verb is a `useAction` `run`: it resolves a `RunResult`, `ok` once the
 * cart is written, and an error the page's `ActionErrorToaster` has already
 * said otherwise. So a caller writes `if ((await ajouter(id, 1)).ok)` and
 * never catches. Reading the cart is `useChargementPanier`'s job, not this
 * hook's.
 */
export const usePanier = () => {
  const client = useClient<CartController>();
  const [panier, setPanier] = useStore(panierAtom);

  const ajout = useAction<[productId: string, quantity: number]>(
    {
      handler: async (_ctx, productId: string, quantity: number) => {
        setPanier(
          await client.commerceCartAdd({ body: { productId, quantity } }),
        );
      },
    },
    [client, setPanier],
  );

  // By line id, not product id: two lines of one product (two slots of a
  // court booking) are told apart only by the line.
  const miseAJour = useAction<[lineId: string, quantity: number]>(
    {
      handler: async (_ctx, lineId: string, quantity: number) => {
        setPanier(
          await client.commerceCartSetQuantity({
            params: { lineId },
            body: { quantity },
          }),
        );
      },
    },
    [client, setPanier],
  );

  const retrait = useAction<[lineId: string]>(
    {
      handler: async (_ctx, lineId: string) => {
        setPanier(await client.commerceCartRemove({ params: { lineId } }));
      },
    },
    [client, setPanier],
  );

  return {
    panier,
    /**
     * Total number of items, for the header badge.
     */
    compte: panier.lines.reduce((sum, line) => sum + line.quantity, 0),
    ajouter: ajout.run,
    definirQuantite: miseAJour.run,
    retirer: retrait.run,
    /**
     * True while any cart write is in flight. A second call to a running verb
     * is dropped by `useAction`, so the controls that send one are held while
     * this is true rather than looking as if they did nothing.
     */
    enCours: ajout.loading || miseAJour.loading || retrait.loading,
  };
};
