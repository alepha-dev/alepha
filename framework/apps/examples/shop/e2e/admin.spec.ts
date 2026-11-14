import type { Page } from "./fixtures.ts";
import { expect, test } from "./fixtures.ts";
import { buy, signInAsAdmin } from "./helpers.ts";

/**
 * The back office.
 *
 * The suite runs serially and shares a database, so these specs assume the
 * catalogue seeded at boot and are careful to leave it as they found it — a spec
 * that unpublishes a piece publishes it again.
 */
test.describe("access", () => {
  test("the admin endpoints refuse an anonymous caller", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/commerce/products");
    expect(res.status()).toBe(401);
  });

  test("the admin shell is not reachable without the permission", async ({
    page,
  }) => {
    await page.goto("/admin/produits");
    // Redirected to sign-in rather than shown an empty table.
    await expect(page).toHaveURL(/\/auth\/login|\/$/);
  });
});

test.describe("catalogue management", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("lists every piece, drafts included, with real stock figures", async ({
    page,
  }) => {
    await page.goto("/admin/produits");
    await expect(
      page.getByRole("cell", { name: /Collier Aurore/ }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: /Bague Nadir/ })).toBeVisible();
    // `count: true` on the admin listing, so the total is a number and not "?".
    await expect(page.getByText(/7 of 7|7 sur 7/)).toBeVisible();
  });

  test("opens a product on its own page with its values", async ({ page }) => {
    await page.goto("/admin/produits");
    await page.getByRole("cell", { name: "Collier Aurore" }).click();

    // A route now, not a drawer: the URL is the product.
    await expect(page).toHaveURL(/\/admin\/produits\/[0-9a-f-]{36}/);

    await expect(page.locator('input[name="name"]')).toHaveValue(
      "Collier Aurore",
    );
    // Prices are edited in cents, and the field says so.
    await expect(page.locator('input[name="price"]')).toHaveValue("8900");
    // The aside distinguishes the three stock numbers that matter.
    await expect(page.getByText("Disponible")).toBeVisible();
    await expect(page.getByText("Réservé")).toBeVisible();
  });

  /**
   * The five tabs are the reason this is a page. Each one reaches product data
   * the drawer could not touch at all.
   */
  test("the product page offers every tab, and the tab is in the URL", async ({
    page,
  }) => {
    await page.goto("/admin/produits");
    await page.getByRole("cell", { name: "Collier Aurore" }).click();
    await expect(page).toHaveURL(/\/admin\/produits\/[0-9a-f-]{36}/);

    await page.getByText("Stock", { exact: true }).click();
    await expect(page).toHaveURL(/[?&]tab=stock/);
    await expect(page.getByText("Historique des mouvements")).toBeVisible();

    await page.getByText("Ventes", { exact: true }).click();
    await expect(page).toHaveURL(/[?&]tab=orders/);
  });

  /**
   * Both of these are built from data that arrives *after* the first render —
   * the kind list and the kind's config schema — and `useForm` captures its
   * schema once. Built with the default deps, the Type picker silently offered
   * no options at all and the config card rendered a submit button over no
   * fields. Neither failed loudly; they were simply empty.
   */
  test("the pickers and the kind config are populated from late-arriving data", async ({
    page,
  }) => {
    await page.goto("/admin/produits");
    await page.getByRole("cell", { name: "Collier Aurore" }).click();
    await expect(page).toHaveURL(/\/admin\/produits\/[0-9a-f-]{36}/);
    const url = page.url().split("?")[0];

    // The Type picker's options come from the kinds query.
    await page.getByRole("combobox").filter({ hasText: "good" }).click();
    await expect(page.getByRole("option", { name: "engraved" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The config form's fields come from that kind's JSON Schema.
    await page.goto(`${url}?tab=details`);
    await expect(page.getByText("Configuration du type")).toBeVisible();
    await expect(page.getByText("Low Stock Threshold")).toBeVisible();
  });

  /**
   * The tax rate had no UI and was not even accepted by the API, so a
   * mixed-rate catalogue was unreachable. This is the end-to-end proof that it
   * now saves.
   */
  test("a VAT rate set in the admin survives a reload", async ({ page }) => {
    await page.goto("/admin/produits");
    await page.getByRole("cell", { name: "Bague Nadir" }).click();
    await expect(page).toHaveURL(/\/admin\/produits\/[0-9a-f-]{36}/);
    const url = page.url();

    await page.locator('input[name="vatRateBps"]').fill("550");
    await page.getByRole("button", { name: "Enregistrer" }).first().click();
    await expect(page.getByText(/Produit enregistré/)).toBeVisible();

    await page.goto(url);
    await expect(page.locator('input[name="vatRateBps"]')).toHaveValue("550");

    // Put it back on the seller's default rate.
    await page.locator('input[name="vatRateBps"]').fill("");
    await page.getByRole("button", { name: "Enregistrer" }).first().click();
  });

  test("the Variants tab writes the combinations an option adds", async ({
    page,
  }) => {
    await page.goto("/admin/produits");
    await page.getByRole("cell", { name: "Alliance Zénith" }).click();
    await page.getByText("Déclinaisons", { exact: true }).click();
    await expect(page.getByText("ZENITH-58")).toBeVisible();

    await page
      .locator('textarea[name="groups"]')
      .fill("Taille: 50, 54, 58, 62");
    await page.getByRole("button", { name: "Enregistrer et générer" }).click();

    await expect(page.getByText("ALLIANCE-ZENITH-62")).toBeVisible();
    await expect(page.getByText("ZENITH-58")).toBeVisible();

    // Back to what the checkout specs and the seed say.
    await page
      .getByRole("listitem")
      .filter({ hasText: "ALLIANCE-ZENITH-62" })
      .getByRole("button", { name: "Supprimer" })
      .click();
    await page.getByRole("button", { name: /Confirmer|Confirm|OK/ }).click();
    await expect(page.getByText("ALLIANCE-ZENITH-62")).toHaveCount(0);
  });

  test("the Prices tab writes a price in another currency", async ({
    page,
  }) => {
    await page.goto("/admin/produits");
    await page.getByRole("cell", { name: "Collier Aurore" }).click();
    await page.getByRole("radio", { name: "Prix" }).click();
    await expect(page.getByText("Vendu en EUR uniquement.")).toBeVisible();

    await page.locator('input[name="price"]').fill("15900");
    await page.getByRole("button", { name: "Enregistrer le prix" }).click();
    await expect(page.getByText(/159[.,]00/)).toBeVisible();

    // Back to what the seed says.
    await page.getByRole("button", { name: "Retirer", exact: true }).click();
    await page.getByRole("button", { name: /Confirmer|Confirm|OK/ }).click();
    await expect(page.getByText("Vendu en EUR uniquement.")).toBeVisible();
  });

  test("a promotion created in the admin is taken by the cart", async ({
    page,
  }) => {
    await page.goto("/admin/promotions");
    await expect(page.getByText("BIENVENUE10")).toBeVisible();

    await page.getByRole("button", { name: "Nouvelle promotion" }).click();
    await page.locator('input[name="name"]').fill("Vingt euros");
    await page.locator('input[name="code"]').fill("VINGT");
    await page.locator('input[name="value"]').fill("2000");
    await page.getByRole("combobox").filter({ hasText: "Pourcentage" }).click();
    await page.getByRole("option", { name: "Montant fixe" }).click();
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("VINGT", { exact: true })).toBeVisible();

    await page.goto("/produit/collier-aurore");
    await page.getByRole("button", { name: "Ajouter au panier" }).click();
    await expect(page.getByText(/dans votre panier/)).toBeVisible();
    await page.goto("/panier");
    await page.locator('input[name="code"]').fill("vingt");
    await page.getByRole("button", { name: "Appliquer" }).click();
    await expect(page.getByText("Vingt euros")).toBeVisible();
  });

  test("a category created in the admin is offered on the product", async ({
    page,
  }) => {
    await page.goto("/admin/categories");
    await page.getByRole("button", { name: "Nouvelle catégorie" }).click();
    await page.locator('input[name="name"]').fill("Bagues");
    await page.locator('input[name="slug"]').fill("bagues");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("bagues", { exact: true })).toBeVisible();

    await page.goto("/admin/produits");
    await page.getByRole("cell", { name: "Bague Nadir" }).click();
    await page.getByRole("combobox", { name: "Catégorie" }).click();
    await expect(page.getByRole("option", { name: "Bagues" })).toBeVisible();
  });

  test("a price edited in the admin shows on the storefront", async ({
    page,
  }) => {
    // Seen first, so the product page is in the page cache when the price
    // changes: what this proves is that the edit purges it (#E78).
    await page.goto("/produit/boucles-eclipse");
    await expect(page.getByText("145 €")).toBeVisible();

    await page.goto("/admin/produits");
    await page.getByRole("cell", { name: "Boucles Éclipse" }).click();
    await expect(page).toHaveURL(/\/admin\/produits\/[0-9a-f-]{36}/);
    const url = page.url();

    await page.locator('input[name="price"]').fill("15500");
    await page.getByRole("button", { name: "Enregistrer" }).first().click();
    await expect(page.getByText(/Produit enregistré/)).toBeVisible();

    await page.goto("/produit/boucles-eclipse");
    await expect(page.getByText("155 €")).toBeVisible();

    // Put it back, so the checkout specs keep their arithmetic.
    await page.goto(url);
    await page.locator('input[name="price"]').fill("14500");
    await page.getByRole("button", { name: "Enregistrer" }).first().click();
    await expect(page.getByText(/Produit enregistré/)).toBeVisible();
  });

  /**
   * "New product" has no form: it writes a draft and opens it. The draft must
   * be invisible to the shop until someone publishes it, which is what makes
   * creating-then-abandoning harmless.
   */
  test("New product creates a draft and opens it, unpublished", async ({
    page,
  }) => {
    await page.goto("/admin/produits");
    await page.getByRole("button", { name: /Nouveau produit/ }).click();

    await expect(page).toHaveURL(/\/admin\/produits\/[0-9a-f-]{36}/);
    const slug = await page.locator('input[name="slug"]').inputValue();
    expect(slug).toMatch(/^product-\d+$/);
    await expect(page.locator('input[name="price"]')).toHaveValue("0");

    // Not on the storefront: a draft is not a product anyone can see.
    const res = await page.request.get(`/produit/${slug}`);
    expect(res.status()).toBe(404);

    // Clean up — it has never been ordered, so it deletes.
    await page.getByRole("button", { name: "Supprimer" }).first().click();
    await page
      .getByRole("button", { name: /^Supprimer$/ })
      .last()
      .click();
    await expect(page).toHaveURL(/\/admin\/produits$/);
  });

  test("restocking raises the availability the storefront quotes", async ({
    page,
  }) => {
    await page.goto("/produit/bracelet-meridien");
    const before = Number(
      (await page.getByText(/\d+ en atelier/).innerText()).match(/\d+/)![0],
    );

    await page.goto("/admin/produits");
    await page
      .getByRole("row", { name: /Bracelet Méridien/ })
      .getByRole("button", {
        name: /Open row actions|Ouvrir les actions de la ligne/,
      })
      .click();
    await page.getByRole("menuitem", { name: "Réapprovisionner" }).click();
    await page.getByRole("button", { name: /Confirmer|Confirm|OK/ }).click();
    await expect(page.getByText(/\+1 en stock/)).toBeVisible();

    await page.goto("/produit/bracelet-meridien");
    await expect(page.getByText(`${before + 1} en atelier`)).toBeVisible();
  });

  test("unpublishing removes a piece from the storefront", async ({ page }) => {
    // The helper waits for the admin row to change, so a failure here is about
    // the storefront and not about whether the withdrawal landed.
    await togglePublication(page, "Retirer de la vente", "Brouillon");
    await page.goto("/");
    await expect(page.getByText("Carte cadeau")).toHaveCount(0);

    await togglePublication(page, "Mettre en vente", "En ligne");
    await page.goto("/");
    await expect(page.getByText("Carte cadeau")).toBeVisible();
  });
});

test.describe("order management", () => {
  test("an order reaches the admin, ships, and refunds", async ({ page }) => {
    await buy(page, "collier-aurore", { shippingCode: "colissimo" });
    await signInAsAdmin(page);

    await page.goto("/admin/commandes");
    await expect(page.getByText("95,90 €").first()).toBeVisible();
    // "Payée", not "paid": order statuses are translated now that
    // `@alepha/commerce` ships a catalogue. The raw identifier was only ever
    // on screen because `tr()` fell through to its own `default:`.
    await expect(page.getByText("Payée").first()).toBeVisible();

    // The detail sheet shows the frozen lines and the delivery address.
    await page.getByText("95,90 €").first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Collier Aurore")).toBeVisible();
    await expect(sheet.getByText("Camille Dupont")).toBeVisible();
    await expect(sheet.getByText("75001 Paris")).toBeVisible();
    await page.keyboard.press("Escape");

    // Ship it, with a tracking number the customer will receive.
    await page
      .getByRole("row", { name: /95,90/ })
      .getByRole("button", {
        name: /Open row actions|Ouvrir les actions de la ligne/,
      })
      .click();
    await page.getByRole("menuitem", { name: "Expédier" }).click();
    await page.getByRole("textbox").last().fill("6A12345678901");
    await page.getByRole("button", { name: /Expédier|Confirmer|OK/ }).click();
    await expect(page.getByText("6A12345678901")).toBeVisible();

    // Refund it. The dialog must name the amount — that is what is consented to.
    await page
      .getByRole("row", { name: /95,90/ })
      .getByRole("button", {
        name: /Open row actions|Ouvrir les actions de la ligne/,
      })
      .click();
    await page.getByRole("menuitem", { name: "Rembourser" }).click();
    // Scoped to the dialog: the amount is also in the table row behind it, and an
    // unscoped match is a strict-mode violation that says nothing about consent.
    const refund = page.getByRole("dialog");
    await expect(refund.getByText(/95,90/)).toBeVisible();

    // Part of it first: an amount and a reason, for the credit note.
    await refund.locator('input[name="amount"]').fill("1000");
    await refund.locator('[name="reason"]').fill("Geste commercial");
    await refund.getByRole("button", { name: "Rembourser" }).click();
    await expect(page.getByText(/remboursée/)).toBeVisible();
    await expect(page.getByText(/-10,00.*remboursés/)).toBeVisible();

    // Then the rest: with nothing narrower asked for, what is left.
    await page
      .getByRole("row", { name: /95,90/ })
      .getByRole("button", {
        name: /Open row actions|Ouvrir les actions de la ligne/,
      })
      .click();
    await page.getByRole("menuitem", { name: "Rembourser" }).click();
    await expect(page.getByRole("dialog").getByText(/85,90/)).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Rembourser" })
      .click();
    await expect(page.getByText("Remboursée", { exact: true })).toBeVisible();
  });

  test("the returns page opens, and lines cancel before shipping", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/retours");
    await expect(page.getByText("Aucun retour.")).toBeVisible();

    await buy(page, "collier-aurore", { shippingCode: "retrait" });
    await page.goto("/admin/commandes");
    await page
      .getByRole("row", { name: /Payée/ })
      .first()
      .getByRole("button", {
        name: /Open row actions|Ouvrir les actions de la ligne/,
      })
      .click();
    await page.getByRole("menuitem", { name: "Annuler des lignes" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(/reviennent en stock/)).toBeVisible();
    await sheet.getByRole("spinbutton").first().fill("1");
    await sheet.getByRole("button", { name: "Rembourser" }).click();
    await expect(page.getByText(/remboursée/)).toBeVisible();
  });

  test("filters by status", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/commandes");

    // By role AND by the value it shows: the toolbar filter has no label any
    // more (it sat directly above a column header that already said
    // "Statut", and its height pushed the toolbar's buttons off-centre), so
    // there is no accessible name to match on.
    //
    // Filtered rather than bare, because the table footer now carries a
    // rows-per-page select of its own and a bare `getByRole("combobox")`
    // resolves to both.
    await page
      .getByRole("combobox")
      .filter({ hasText: "Tous les statuts" })
      .click();
    await page.getByRole("option", { name: "En attente" }).click();
    // No pending orders survive a completed funnel, so the table is empty and
    // says so rather than showing a spinner forever.
    await expect(
      page.getByText(/Aucune commande|Aucun résultat|No results/),
    ).toBeVisible();
  });
});

test.describe("delivery management", () => {
  test("lists the zones as tabs and their rates", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/livraison");

    await expect(page.getByRole("tab", { name: /France/ })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /Union européenne/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: /Colissimo suivi/ }),
    ).toBeVisible();
    await expect(page.getByText("6,90 €")).toBeVisible();
  });

  test("switching zone swaps the rate list", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/livraison");

    await page.getByRole("tab", { name: /Union européenne/ }).click();
    await expect(
      page.getByRole("cell", { name: /Standard Europe/ }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: /Colissimo/ })).toHaveCount(0);
  });
});

/**
 * Flip a piece's publication through the row menu, confirmation included.
 *
 * The trigger is addressed by its accessible name rather than as "the last
 * button in the row": the count of buttons in a row is an accident of layout,
 * and a spec that depends on it fails for reasons that have nothing to do with
 * publishing.
 *
 * The confirmation button says "Confirm" — `useDialog`'s own default, which the
 * shop does not translate yet. Matching both spellings keeps the spec honest
 * either way.
 */
const togglePublication = async (
  page: Page,
  item: string,
  becomes: string,
): Promise<void> => {
  await page.goto("/admin/produits");
  await page
    .getByRole("row", { name: /Carte cadeau/ })
    .getByRole("button", {
      name: /Open row actions|Ouvrir les actions de la ligne/,
    })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
  await page.getByRole("button", { name: /Confirmer|Confirm/ }).click();
  /*
   * Wait for the row to actually change before returning.
   *
   * Without this the helper returned the instant the dialog was dismissed, and
   * the caller's `page.goto("/")` cancelled the mutation still in flight. The
   * withdrawal appeared to work — an assertion in between gave it time to land —
   * and the restore did not, which read as "unpublishing works, publishing is
   * broken" when in fact both were racing and one happened to win.
   */
  await expect(
    page.getByRole("row", { name: /Carte cadeau/ }).getByText(becomes),
  ).toBeVisible();
};

/**
 * The way an administrator actually gets in.
 *
 * Every other spec here reaches the back office with `page.goto`, and that is
 * precisely how a dead menu item survived: the entry point a real
 * administrator uses had no coverage at all. `Layout.tsx` passes
 * `onAdminClick`, which takes `AdminMenuItem`'s escape hatch — and that branch
 * skips the route-existence guard the `routeName` branch runs, so a stale route
 * name renders a visible item that silently does nothing instead of hiding
 * itself. A URL-driven suite cannot see that.
 */
test.describe("the header's way in", () => {
  test("the Admin Panel menu item lands on the catalogue", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Mon compte" }).click();
    await page.getByRole("menuitem", { name: "Admin Panel" }).click();

    await expect(page).toHaveURL(/\/admin\/produits/);
  });

  /**
   * The header reads the visitor, yet the page is shared (#E78): the account
   * button sits in `<Personal>`, so the cached HTML holds a placeholder and
   * each visitor's own button appears after hydration, from their own private
   * state. A page cached by an anonymous visitor must give an administrator
   * their account menu, and give the next anonymous visitor the sign-in icon.
   */
  test("a cached page shows each visitor their own account button", async ({
    page,
    browser,
  }) => {
    const anonymous = await browser.newPage();
    await anonymous.goto("/atelier");
    // Filled at stream end, after the last byte left.
    await anonymous.waitForTimeout(200);

    await signInAsAdmin(page);
    const response = await page.goto("/atelier");
    expect(response?.headers()["x-alepha-cache"]).toBe("hit; verdict=variant");
    await expect(
      page.getByRole("button", { name: "Mon compte" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Se connecter|Sign in/ }),
    ).toHaveCount(0);

    await anonymous.reload();
    await expect(
      anonymous.getByRole("button", { name: /Se connecter|Sign in/ }),
    ).toBeVisible();
    await expect(
      anonymous.getByRole("button", { name: "Mon compte" }),
    ).toHaveCount(0);
    await anonymous.close();
  });
});

/**
 * The sidebar, asserted as one ordered list.
 *
 * Ordering is the entire point of the reserved band — the built-ins sit at
 * `order` 1000+ so this shop's `Commerce` group at the conventional 100 leads
 * — and a per-item assertion cannot see a wrong order at all. Reading the
 * whole list is the only assertion that can fail when the numbering slips.
 *
 * Scoped to `[data-slot="sidebar-menu-item"]` rather than filtered by href:
 * the dashboard's link is `/admin` itself, which the shell's breadcrumb also
 * points at, so no href filter can separate them.
 *
 * Parameters is here despite nothing importing `alepha/api/parameters`:
 * `$realm`, which `ShopRealm` uses, registers it. Its presence is the `can()`
 * gate working, not a leak.
 */
test.describe("the admin sidebar", () => {
  test("leads with the dashboard, then the shop's own group", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/produits");

    const entries = await page
      .locator('[data-slot="sidebar-menu-item"] a')
      .evaluateAll((links) =>
        links.map(
          (a) => `${a.getAttribute("href")} ${(a.textContent ?? "").trim()}`,
        ),
      );

    /*
     * French throughout, the shop's own entries and the framework's alike.
     * The built-ins used to read "Dashboard / Users / Audit log" here: their
     * labels were class fields evaluated once, outside React, so the shell
     * could not follow the language the rest of the shop was in. They now
     * name a catalogue key that `navLabel` resolves at render time, and the
     * shop spreads `uiFr`, so this list is the whole fix stated as text.
     */
    expect(entries).toEqual([
      "/admin Tableau de bord",
      "/admin/produits Produits",
      "/admin/commandes Commandes",
      "/admin/livraison Livraison",
      "/admin/promotions Promotions",
      "/admin/categories Catégories",
      "/admin/retours Retours",
      "/admin/users Utilisateurs",
      "/admin/sessions Sessions",
      "/admin/audits Journal d'audit",
      "/admin/jobs Tâches",
      "/admin/notifications Notifications",
      "/admin/files Fichiers",
      "/admin/payments Paiements",
      "/admin/webhooks Webhooks",
      "/admin/parameters Paramètres",
    ]);
  });

  test("a bare /admin IS the dashboard, showing the shop's tiles first", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/admin");

    // Stays put. The dashboard is the shell's index child, so there is no
    // redirect to a second URL — asserting the URL is unchanged is what
    // would catch an index redirect creeping back in.
    await expect(page).toHaveURL(/\/admin$/);
    /*
     * The whole tile set, in order.
     *
     * The shop's two cards carry no `order`, so they sort at 0 and lead the
     * three built-ins parked at 1000 and up. Asserted as an exact list rather
     * than per-tile visibility, because that an application's cards come
     * first is the load-bearing half and a looser check would not see it.
     */
    const tiles = await page
      .locator('[data-slot="card-title"]')
      .allInnerTexts();

    expect(tiles.map((tile) => tile.trim())).toEqual([
      "Produits",
      "Commandes",
      // The built-in tile reads its label from the same key as the sidebar
      // entry it links to, so it is French here too.
      "Utilisateurs",
      "Connectés",
      "Connexions échouées",
    ]);
  });
});

/**
 * Each built-in tile opens its list filtered to the same number (#Q3536),
 * and a filter the admin stored on that list last time does not narrow it:
 * the Users tile carries no filter of its own, so it relies on `?filters=none`.
 */
test.describe("the dashboard's tiles", () => {
  // The card title, not any link: the sidebar entry says "Utilisateurs" too.
  const tileOf = (page: Page, label: string) =>
    page.getByRole("link").filter({
      has: page
        .locator('[data-slot="card-title"]')
        .getByText(label, { exact: true }),
    });

  const tileValue = async (page: Page, label: string) => {
    const value = tileOf(page, label).locator('[data-slot="stat-value"]');
    await expect(value).toHaveText(/^[\d\s\u202f.,]+$/);
    return Number((await value.innerText()).replace(/\D/g, ""));
  };

  const expectListTotal = async (page: Page, total: number) => {
    // The footer reads "Page 1 sur 1 · 3 sur 3"; an empty list says so.
    if (total === 0) {
      await expect(page.getByText(/Aucun résultat|No results/)).toBeVisible();
      return;
    }
    await expect(
      page.getByText(new RegExp(`·\\s*\\d+ sur ${total}$`)),
    ).toBeVisible();
  };

  test("each tile's click lands on a list whose total equals the tile, even with a stored filter", async ({
    page,
  }) => {
    // One failed sign-in, so the failures tile has something to count.
    await page.goto("/auth/login");
    await page.locator('input[name="identifier"]').fill("nobody@example.test");
    await page.locator('input[name="password"]').fill("not-the-password");
    await page.getByRole("button", { name: /Sign in|Se connecter/ }).click();
    await expect(page.locator('input[name="password"]')).toBeVisible();

    await signInAsAdmin(page);
    await page.goto("/admin");
    // Stored filters that would each narrow the list under its tile.
    await page.evaluate(() => {
      window.localStorage.setItem(
        "admin.users.filters",
        JSON.stringify({ status: "disabled" }),
      );
      window.localStorage.setItem(
        "admin.audits.filters",
        JSON.stringify({ status: "ok" }),
      );
    });

    for (const [label, url] of [
      ["Utilisateurs", /\/admin\/users\?filters=none$/],
      ["Connectés", /\/admin\/users\?active=24$/],
      [
        "Connexions échouées",
        /\/admin\/audits\?status=failed&type=auth,security&createdAt=/,
      ],
    ] as const) {
      await page.goto("/admin");
      const value = await tileValue(page, label);
      await tileOf(page, label).click();
      await expect(page).toHaveURL(url);
      await expectListTotal(page, value);
    }
  });

  /**
   * The stored layout is read by the page's loader (#Q3537), on the server,
   * and shipped with the page: the first render is already the final grid,
   * and the browser never fetches the layout after mount, so no tile moves.
   * (The admin shell is client-rendered, being behind a guard, but its
   * loaders still run on the server.)
   */
  test("the first render is the stored layout, with no fetch after mount", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    const read = await page.request.get("/api/dashboard/layout");
    expect(read.ok()).toBe(true);
    const { version } = (await read.json()) as { version: number };
    const save = (tiles: Array<{ id: string; enabled: boolean }>, at: number) =>
      page.request.put("/api/dashboard/layout", {
        data: { layout: { tiles }, expectedVersion: at },
      });

    const saved = await save(
      [
        { id: "failed-sign-ins", enabled: true },
        { id: "users", enabled: true },
        { id: "shop-pieces", enabled: false },
      ],
      version,
    );
    expect(saved.ok()).toBe(true);

    try {
      const layoutReads: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/dashboard/layout")) {
          layoutReads.push(request.url());
        }
      });
      await page.goto("/admin");
      await expect(page.locator('[data-slot="card-title"]')).toHaveCount(4);
      const titles = await page
        .locator('[data-slot="card-title"]')
        .allInnerTexts();
      // The layout's two, then the tiles it does not name, in code order.
      expect(titles.map((title) => title.trim())).toEqual([
        "Connexions échouées",
        "Utilisateurs",
        "Commandes",
        "Connectés",
      ]);
      expect(layoutReads).toEqual([]);
    } finally {
      // Back to the code defaults for the specs that follow.
      expect((await save([], version + 1)).ok()).toBe(true);
    }
  });
});

/**
 * Customize mode (#Q3538): one layout for every admin, saved with a version
 * check, so a second admin sees it and a concurrent save gets a notice.
 */
test.describe("customizing the dashboard", () => {
  const SECOND = {
    email: "second-admin@example.test",
    password: "second-admin-2026",
  };

  const titlesOf = async (page: Page) =>
    (await page.locator('[data-slot="card-title"]').allInnerTexts()).map(
      (title) => title.trim(),
    );

  const cellTitles = async (page: Page) =>
    (
      await page
        .locator('[data-slot="dashboard-edit-cell"] > div:first-child span')
        .allInnerTexts()
    ).map((title) => title.trim());

  test("hide and reorder, save, reload; a second admin sees it; a concurrent save gets the notice", async ({
    page,
    browser,
    baseURL,
  }) => {
    await signInAsAdmin(page);

    // A second admin, made through the admin API by the first.
    const created = await page.request.post("/api/users", {
      data: {
        email: SECOND.email,
        username: "second-admin",
        roles: ["admin"],
        emailVerified: true,
      },
    });
    expect(created.ok()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    expect(
      (
        await page.request.post(`/api/users/${id}/password`, {
          data: { password: SECOND.password },
        })
      ).ok(),
    ).toBe(true);

    const second = await browser.newContext({ baseURL, locale: "fr-FR" });
    const other = await second.newPage();
    await other.goto("/auth/login");
    await other.locator('input[name="identifier"]').fill(SECOND.email);
    await other.locator('input[name="password"]').fill(SECOND.password);
    await other.getByRole("button", { name: /Sign in|Se connecter/ }).click();
    await other.waitForURL((url) => !url.pathname.startsWith("/auth/"));

    try {
      // The first admin hides Commandes and moves Connectés first.
      await page.goto("/admin");
      await page.getByRole("button", { name: "Personnaliser" }).click();
      await expect(
        page.getByText(
          "Les modifications s'appliquent à tous les administrateurs.",
        ),
      ).toBeVisible();
      await page.getByRole("button", { name: "Retirer Commandes" }).click();
      for (let i = 0; i < 2; i++) {
        await page.getByRole("button", { name: "Avancer Connectés" }).click();
      }
      expect(await cellTitles(page)).toEqual([
        "Connectés",
        "Produits",
        "Utilisateurs",
        "Connexions échouées",
      ]);

      // The second admin opens Customize on the same version, meanwhile.
      await other.goto("/admin");
      await other.getByRole("button", { name: "Personnaliser" }).click();

      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(
        page.getByRole("button", { name: "Personnaliser" }),
      ).toBeVisible();
      const expected = [
        "Connectés",
        "Produits",
        "Utilisateurs",
        "Connexions échouées",
      ];
      expect(await titlesOf(page)).toEqual(expected);

      await page.reload();
      await expect(page.locator('[data-slot="card-title"]')).toHaveCount(4);
      expect(await titlesOf(page)).toEqual(expected);

      // The second admin's save started from the old version: refused, with
      // the notice, and the first admin's layout stands.
      await other.getByRole("button", { name: "Retirer Produits" }).click();
      await other.getByRole("button", { name: "Enregistrer" }).click();
      await expect(
        other.getByText(
          "Un autre administrateur a enregistré la disposition entre-temps",
        ),
      ).toBeVisible();
      await other
        .getByRole("button", { name: "Charger sa disposition" })
        .click();
      await expect(
        other.getByRole("button", { name: "Personnaliser" }),
      ).toBeVisible();
      await expect(other.locator('[data-slot="card-title"]')).toHaveCount(4);
      expect(await titlesOf(other)).toEqual(expected);

      // Reset, confirmed: back to the defaults for everyone.
      await other.getByRole("button", { name: "Personnaliser" }).click();
      await other
        .getByRole("button", { name: "Rétablir les tuiles par défaut" })
        .click();
      await other
        .getByRole("alertdialog")
        .getByRole("button", { name: "Rétablir les tuiles par défaut" })
        .click();
      await expect(
        other.getByRole("button", { name: "Personnaliser" }),
      ).toBeVisible();
      await page.reload();
      await expect(page.locator('[data-slot="card-title"]')).toHaveCount(5);
      expect(await titlesOf(page)).toEqual([
        "Produits",
        "Commandes",
        "Utilisateurs",
        "Connectés",
        "Connexions échouées",
      ]);
    } finally {
      await second.close();
    }
  });
});
