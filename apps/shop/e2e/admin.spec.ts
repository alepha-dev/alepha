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
    await page.goto("/admin/pieces");
    // Redirected to sign-in rather than shown an empty table.
    await expect(page).toHaveURL(/\/compte\/connexion|\/$/);
  });
});

test.describe("catalogue management", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("lists every piece, drafts included, with real stock figures", async ({
    page,
  }) => {
    await page.goto("/admin/pieces");
    await expect(
      page.getByRole("cell", { name: /Collier Aurore/ }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: /Bague Nadir/ })).toBeVisible();
    // `count: true` on the admin listing, so the total is a number and not "?".
    await expect(page.getByText(/6 of 6|6 sur 6/)).toBeVisible();
  });

  test("opens a piece in the editor with its values", async ({ page }) => {
    await page.goto("/admin/pieces");
    await page.getByRole("cell", { name: "Collier Aurore" }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('input[name="name"]')).toHaveValue(
      "Collier Aurore",
    );
    // Prices are edited in cents, and the field says so.
    await expect(sheet.locator('input[name="price"]')).toHaveValue("8900");
    // The stock panel distinguishes the three numbers that matter.
    await expect(sheet.getByText("Disponible")).toBeVisible();
    await expect(sheet.getByText("Réservé")).toBeVisible();
  });

  test("a price edited in the admin shows on the storefront", async ({
    page,
  }) => {
    await page.goto("/admin/pieces");
    await page.getByRole("cell", { name: "Boucles Éclipse" }).click();

    const sheet = page.getByRole("dialog");
    await sheet.locator('input[name="price"]').fill("15500");
    await sheet.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText(/Pièce enregistrée/)).toBeVisible();

    await page.goto("/piece/boucles-eclipse");
    await expect(page.getByText("155 €")).toBeVisible();

    // Put it back, so the checkout specs keep their arithmetic.
    await page.goto("/admin/pieces");
    await page.getByRole("cell", { name: "Boucles Éclipse" }).click();
    await page.getByRole("dialog").locator('input[name="price"]').fill("14500");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Enregistrer" })
      .click();
    await expect(page.getByText(/Pièce enregistrée/)).toBeVisible();
  });

  test("restocking raises the availability the storefront quotes", async ({
    page,
  }) => {
    await page.goto("/piece/bracelet-meridien");
    const before = Number(
      (await page.getByText(/\d+ en atelier/).innerText()).match(/\d+/)![0],
    );

    await page.goto("/admin/pieces");
    await page
      .getByRole("row", { name: /Bracelet Méridien/ })
      .getByRole("button", {
        name: /Open row actions|Ouvrir les actions de la ligne/,
      })
      .click();
    await page.getByRole("menuitem", { name: "Réapprovisionner" }).click();
    await page.getByRole("button", { name: /Confirmer|Confirm|OK/ }).click();
    await expect(page.getByText(/\+1 en stock/)).toBeVisible();

    await page.goto("/piece/bracelet-meridien");
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
    await expect(page.getByText("paid").first()).toBeVisible();

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

    await page.getByLabel("Statut").click();
    await page.getByRole("option", { name: "pending" }).click();
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
  await page.goto("/admin/pieces");
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
