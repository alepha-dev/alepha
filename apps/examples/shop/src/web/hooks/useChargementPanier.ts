import type { CartController } from "@alepha/commerce/cart";
import { useClient, useQuery, useStore } from "alepha/react";

import { panierAtom } from "../panierAtom.ts";

/**
 * Read the cart from the server into `panierAtom`.
 *
 * The cart lives in a signed cookie, so the browser only learns what is in it
 * by asking. Keyed `["cart"]`, so the header and the cart page, mounted at the
 * same time, share one request. The atom stays the source every component
 * reads: the writes in `usePanier` answer with the whole cart and write it
 * there directly, so nothing reads this query's own `data`.
 */
export const useChargementPanier = () => {
  const client = useClient<CartController>();
  const [, setPanier] = useStore(panierAtom);

  useQuery(
    {
      key: ["cart"],
      handler: () => client.commerceCartGet(),
      onSuccess: (panier) => setPanier(panier),
    },
    [client, setPanier],
  );
};
