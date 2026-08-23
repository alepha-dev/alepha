import type { CartController } from "@alepha/commerce/cart";
import { useClient, useStore } from "alepha/react";
import { useCallback } from "react";

import { panierAtom } from "../panierAtom.ts";

/**
 * Read and mutate the cart.
 *
 * Every mutation returns the whole priced cart from the server and writes it
 * straight into the atom, so there is no client-side cart arithmetic to drift
 * from the server's. That is the same rule the domain follows — one place
 * computes a total — applied to the front end.
 */
export const usePanier = () => {
  const client = useClient<CartController>();
  const [panier, setPanier] = useStore(panierAtom);

  const refresh = useCallback(async () => {
    setPanier(await client.commerceCartGet());
  }, [client, setPanier]);

  const ajouter = useCallback(
    async (productId: string, quantity = 1) => {
      setPanier(
        await client.commerceCartAdd({ body: { productId, quantity } }),
      );
    },
    [client, setPanier],
  );

  const definirQuantite = useCallback(
    async (productId: string, quantity: number) => {
      setPanier(
        await client.commerceCartSetQuantity({
          params: { productId },
          body: { quantity },
        }),
      );
    },
    [client, setPanier],
  );

  const retirer = useCallback(
    async (productId: string) => {
      setPanier(await client.commerceCartRemove({ params: { productId } }));
    },
    [client, setPanier],
  );

  return {
    panier,
    /**
     * Total number of items, for the header badge.
     */
    compte: panier.lines.reduce((sum, line) => sum + line.quantity, 0),
    refresh,
    ajouter,
    definirQuantite,
    retirer,
  };
};
