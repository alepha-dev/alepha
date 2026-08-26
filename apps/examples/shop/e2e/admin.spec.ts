import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

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
    await expect(page.getByText(/6 of 6|6 sur 6/)).toBeVisible();
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

  test("a price edited in the admin shows on the storefront", async ({
    page,
  }) => {
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
    await expect(
      page.getByRole("alertdialog").getByText(/95,90/),
    ).toBeVisible();
    await page.getByRole("button", { name: /Confirmer|Confirm|OK/ }).click();
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
      "/admin/users Utilisateurs",
      "/admin/sessions Sessions",
      "/admin/audits Journal d'audit",
      "/admin/jobs Tâches",
      "/admin/notifications Notifications",
      "/admin/files Fichiers",
      "/admin/payments Paiements",
      "/admin/workflows Workflows",
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
     * single built-in parked at 1000. Asserted as an exact list rather than
     * per-tile visibility because both halves of the decision are
     * load-bearing and invisible to a looser check: that an application's
     * cards come first, and that the framework ships exactly ONE baseline
     * tile rather than a dashboard of its own plumbing.
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
    ]);
  });
});
