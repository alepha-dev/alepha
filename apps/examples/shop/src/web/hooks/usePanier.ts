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
 * Each verb is a `useAction`: it resolves `true` once the cart is written, and
 * `undefined` when the request failed, which the page's `ActionErrorToaster`
 * has already said. So a caller writes `if (await ajouter(id, 1))` and never
 * catches. Reading the cart is `useChargementPanier`'s job, not this hook's.
 */
export const usePanier = () => {
  const client = useClient<CartController>();
  const [panier, setPanier] = useStore(panierAtom);

  const ajout = useAction<[productId: string, quantity: number], boolean>(
    {
      // `quantity` is required, never defaulted: `useAction` appends
      // `{ signal }` as the last argument, which a `quantity = 1` left out by
      // the caller would receive and send as the quantity.
      handler: async (productId: string, quantity: number) => {
        setPanier(
          await client.commerceCartAdd({ body: { productId, quantity } }),
        );
        return true;
      },
    },
    [client, setPanier],
  );

  const miseAJour = useAction<[productId: string, quantity: number], boolean>(
    {
      handler: async (productId: string, quantity: number) => {
        setPanier(
          await client.commerceCartSetQuantity({
            params: { productId },
            body: { quantity },
          }),
        );
        return true;
      },
    },
    [client, setPanier],
  );

  const retrait = useAction<[productId: string], boolean>(
    {
      handler: async (productId: string) => {
        setPanier(await client.commerceCartRemove({ params: { productId } }));
        return true;
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
