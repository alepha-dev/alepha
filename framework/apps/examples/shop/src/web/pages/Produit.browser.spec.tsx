import type { PublicProduct } from "@alepha/commerce";
import { Toaster } from "@alepha/ui";
import { ActionErrorToaster } from "@alepha/ui/shell";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ShopI18n } from "../ShopI18n.ts";
import Produit from "./Produit.tsx";

const PRODUIT: PublicProduct = {
  id: "0199a0f0-0000-7000-8000-000000000001",
  kind: "physical",
  slug: "collier-aurore",
  name: "Collier Aurore",
  price: 12000,
  currency: "EUR",
  images: [],
  attributes: {},
  available: 3,
};

/**
 * The cart's add button, on `usePanier`'s `useAction` verbs (#Q2332).
 *
 * Two things this page used to get wrong or could get wrong. A refused add was
 * caught and toasted by hand, with the storefront mounting no action-error
 * toaster at all; it is toasted once by the layout's listener now. And
 * `ajouter(productId, quantity = 1)` called with one argument would have sent
 * `useAction`'s `{ signal }` as the quantity.
 */
describe("Produit", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  /**
   * `name` differs per test: sonner's toast store is module-level, so the
   * success toast one test raises is still on screen in the next.
   */
  const mount = async (
    name: string,
    commerceCartAdd: (req: any) => Promise<unknown>,
  ) => {
    class Links extends LinkProvider {
      override client(): any {
        return new Proxy({} as Record<string, unknown>, {
          get: (_target, key: string) => {
            const action: any =
              key === "commerceCartAdd" ? commerceCartAdd : async () => ({});
            action.can = () => true;
            return action;
          },
        });
      }
    }
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: Links })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(ShopI18n);
    await alepha.start();
    render(
      <AlephaContext.Provider value={alepha}>
        <Toaster visibleToasts={20} />
        <ActionErrorToaster />
        <Produit produit={{ ...PRODUIT, name }} disponible={3} />
      </AlephaContext.Provider>,
    );
    return screen.findByRole("button", { name: /add to basket/i });
  };

  it("sends a quantity of one, never the action context", async () => {
    const bodies: unknown[] = [];
    const bouton = await mount("Collier Aurore", async (req) => {
      bodies.push(req.body);
      return { lines: [], subtotal: 0, currency: "EUR" };
    });

    fireEvent.click(bouton);

    await waitFor(() =>
      expect(bodies).toEqual([{ productId: PRODUIT.id, quantity: 1 }]),
    );
  });

  it("toasts a refused add exactly once, and not the success toast", async () => {
    let calls = 0;
    const bouton = await mount("Bague Refusée", async () => {
      calls++;
      throw new Error("Plus de stock pour cette pièce (spec)");
    });

    fireEvent.click(bouton);

    await waitFor(() =>
      expect(
        screen.getAllByText("Plus de stock pour cette pièce (spec)"),
      ).toHaveLength(1),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toBe(1);
    expect(
      screen.getAllByText("Plus de stock pour cette pièce (spec)"),
    ).toHaveLength(1);
    expect(screen.queryByText(/Bague Refusée is in your basket/)).toBeNull();
  });
});
