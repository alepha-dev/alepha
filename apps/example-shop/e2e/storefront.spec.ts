import { expect, test } from "@playwright/test";

/**
 * The storefront, as a customer meets it.
 *
 * Assertions read visible French text rather than test ids, because that text is
 * the product: a heading that stops saying what it said is a change worth
 * failing on.
 */
test.describe("catalogue", () => {
  test("server-renders the pieces, so a crawler sees them", async ({
    page,
    request,
  }) => {
    // The raw payload, not the hydrated DOM — this is the SSR claim.
    const html = await (await request.get("/")).text();
    expect(html).toContain("Collier Aurore");
    expect(html).toContain("Bague Nadir");

    await page.goto("/");
    await expect(page.locator("main ul > li")).toHaveCount(6);
  });

  test("every drawing loads from the files module", async ({ page }) => {
    await page.goto("/");
    const drawings = page.locator("main img");
    await expect(drawings.first()).toBeVisible();

    const state = await drawings.evaluateAll((els) =>
      els.map((e) => ({
        src: e.getAttribute("src"),
        loaded: (e as HTMLImageElement).naturalWidth > 0,
      })),
    );
    // A broken drawing was a real bug: `$action` mounts under `/api`, and the
    // SPA catch-all answers the app's own HTML for a wrong path, so the browser
    // reports a broken image and never a 404.
    expect(state.every((s) => s.loaded)).toBe(true);
    expect(state.every((s) => s.src?.startsWith("/api/public/files/"))).toBe(
      true,
    );
  });

  test("the spec plate states the metal and its fineness", async ({ page }) => {
    await page.goto("/produit/collier-aurore");
    await expect(page.getByText("Argent", { exact: false })).toBeVisible();
    await expect(page.getByText("925 ‰")).toBeVisible();
    await expect(page.getByText("4,2 g")).toBeVisible();
  });

  test("availability is stated as a fact, not as urgency", async ({ page }) => {
    await page.goto("/produit/collier-aurore");
    await expect(page.getByText(/\d+ en atelier/)).toBeVisible();
    // No pressure tactics in the copy.
    await expect(page.getByText(/Plus que|Vite|Dernière chance/)).toHaveCount(
      0,
    );
  });

  test("a made-to-order piece says it is engraved after ordering", async ({
    page,
  }) => {
    await page.goto("/produit/bague-solstice");
    await expect(page.getByText(/Gravé après commande/)).toBeVisible();
  });

  test("a dematerialised piece promises immediate delivery", async ({
    page,
  }) => {
    await page.goto("/produit/carte-cadeau-50");
    // The spec plate, not the paragraph below it: the page says "Envoi immédiat"
    // twice, and an unqualified match is a strict-mode violation.
    await expect(
      page.getByText("Envoi immédiat", { exact: true }),
    ).toBeVisible();
  });

  test("the workshop page explains the hallmark", async ({ page }) => {
    await page.goto("/atelier");
    await expect(page.getByText("750 millièmes d'or fin")).toBeVisible();
    await expect(page.getByText("925 millièmes d'argent fin")).toBeVisible();
  });

  /*
   * This was a recorded gap for most of this suite's life: a streamed page
   * flushes its `<head>` before the loader runs, so the status was committed
   * before anyone knew the slug matched nothing, and an unknown piece answered
   * 200 with the error boundary — a soft 404 a crawler indexes as a real page.
   *
   * Fixed by `stream: false` on the piece route, which buffers the HTML so
   * `onServerResponse` can still set the status. The option is new; the trade-off
   * it makes explicit (first byte versus status code) was previously not
   * expressible at all.
   */
  test("an unknown piece answers 404", async ({ request }) => {
    const res = await request.get("/produit/nexiste-pas");
    expect(res.status()).toBe(404);
  });

  /*
   * `/piece/:slug` was this shop's public product URL until the catalogue
   * stopped calling its rows *pièces*. It is live and indexed, so it has to
   * keep working — and the slug has to survive the hop, which is the part a
   * static redirect could not do.
   */
  test("the old /piece/ URL redirects to /produit/, keeping the slug", async ({
    request,
  }) => {
    const res = await request.get("/piece/collier-aurore", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toBe("/produit/collier-aurore");
  });

  test("following the old /piece/ URL lands on the product", async ({
    page,
  }) => {
    await page.goto("/piece/collier-aurore");
    await expect(page).toHaveURL(/\/produit\/collier-aurore$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("cart", () => {
  test("empty cart invites action instead of dead-ending", async ({ page }) => {
    await page.goto("/panier");
    await expect(
      page.getByRole("heading", { name: "Panier vide" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Voir les pièces" }),
    ).toBeVisible();
  });

  test("adding a piece updates the header count and the cart", async ({
    page,
  }) => {
    await page.goto("/produit/collier-aurore");
    await page.getByRole("button", { name: "Ajouter au panier" }).click();
    await expect(page.getByText(/dans votre panier/)).toBeVisible();

    // The badge lives in the header and reads from the shared cart atom.
    await expect(page.locator("header nav")).toContainText("1");

    await page.goto("/panier");
    await expect(
      page.getByRole("heading", { name: "Collier Aurore" }),
    ).toBeVisible();
    await expect(page.getByText("89 €").first()).toBeVisible();
  });

  test("the cart survives a reload, because it lives in a signed cookie", async ({
    page,
  }) => {
    await page.goto("/produit/boucles-eclipse");
    await page.getByRole("button", { name: "Ajouter au panier" }).click();
    await expect(page.getByText(/dans votre panier/)).toBeVisible();

    await page.goto("/panier");
    await expect(
      page.getByRole("heading", { name: "Boucles Éclipse" }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Boucles Éclipse" }),
    ).toBeVisible();
  });

  test("changing a quantity re-prices from the server", async ({ page }) => {
    await page.goto("/produit/collier-aurore");
    await page.getByRole("button", { name: "Ajouter au panier" }).click();
    await expect(page.getByText(/dans votre panier/)).toBeVisible();

    await page.goto("/panier");
    await page.locator('input[type="number"]').first().fill("3");
    // 3 × 89,00 € — computed by `CartService.price()`, the one authoritative path.
    await expect(page.getByText("267 €").first()).toBeVisible();
  });

  test("removing the last line empties the cart", async ({ page }) => {
    await page.goto("/produit/collier-aurore");
    await page.getByRole("button", { name: "Ajouter au panier" }).click();
    await expect(page.getByText(/dans votre panier/)).toBeVisible();

    await page.goto("/panier");
    await page.getByRole("button", { name: "Retirer" }).first().click();
    await expect(
      page.getByRole("heading", { name: "Panier vide" }),
    ).toBeVisible();
  });
});

test.describe("interface", () => {
  test("switches between French and English", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Produits" })).toBeVisible();

    /*
     * The menu closes when a language is chosen, so reopening it is the real
     * gesture. It did not always: `DropdownMenuCheckboxItem` keeps a menu open by
     * default, and this spec is what surfaced it — the second trigger click was
     * closing a menu that was still open, and the following click then fought the
     * closing animation for sixty seconds ("element is not stable"). The fix went
     * into `@alepha/ui`, not into this spec.
     */
    await page.getByRole("button", { name: "Switch language" }).click();
    await page.getByRole("menuitemcheckbox", { name: "English" }).click();
    await expect(page.getByRole("link", { name: "Products" })).toBeVisible();

    await page.getByRole("button", { name: "Switch language" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Français" }).click();
    await expect(page.getByRole("link", { name: "Produits" })).toBeVisible();
  });

  test("reads on a phone without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
  });

  test("the first interactive element is reachable by keyboard", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      outline: getComputedStyle(document.activeElement!).outlineStyle,
    }));
    expect(focused.tag).toBeTruthy();
    // The identity's focus ring is gold and must be visible on both grounds.
    expect(focused.outline).not.toBe("none");
  });
});

test.describe("header account button", () => {
  /*
   * `ButtonUser` disables its sign-in icon when `onSignIn` is absent, and the
   * shop rendered a bare `<ButtonUser />` — so the button sat there greyed out on
   * every page, with `pointer-events: none`. Thirty-five specs passed over it
   * because not one of them looked at the header's account control: they went to
   * the sign-in page by URL, which works whether or not anything links to it.
   *
   * Asserting `toBeEnabled` rather than the click alone is deliberate: a disabled
   * button is what a visitor actually sees, and it is what regressed.
   */
  test("the header offers a way to sign in", async ({ page }) => {
    await page.goto("/");

    const signIn = page.getByRole("button", { name: /Se connecter|Sign in/ });
    await expect(signIn).toBeEnabled();

    await signIn.click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
