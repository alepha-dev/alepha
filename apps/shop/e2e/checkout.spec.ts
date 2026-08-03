import { expect, test } from "@playwright/test";
import { buy, selectCountry } from "./helpers.ts";

/**
 * The checkout, which is where the money and the law are.
 *
 * Every assertion here is about a figure or a legal statement, because those are
 * the two things a customer can hold the shop to.
 */
test.describe("address", () => {
  test("rejects a postcode that belongs to another country", async ({
    page,
  }) => {
    await page.goto("/piece/collier-aurore");
    await page.getByRole("button", { name: "Ajouter au panier" }).click();
    await expect(page.getByText(/dans votre panier/)).toBeVisible();

    await page.goto("/commande");
    await page.locator('input[name="email"]').fill("camille@example.test");
    await page.locator('input[name="fullName"]').fill("Camille Dupont");
    await page.locator('input[name="line1"]').fill("12 rue des Orfèvres");
    // Four digits is Belgian, not French.
    await page.locator('input[name="postalCode"]').fill("1000");
    await page.locator('input[name="locality"]').fill("Paris");
    await page.getByRole("button", { name: "Continuer" }).click();

    // The server names the offending field and the expected shape; the UI shows
    // its message rather than a generic banner.
    await expect(
      page.getByText(/n'est pas un code postal valide|75001/),
    ).toBeVisible();
  });

  test("accepts a Dutch postcode with letters", async ({ page }) => {
    await page.goto("/piece/collier-aurore");
    await page.getByRole("button", { name: "Ajouter au panier" }).click();
    await expect(page.getByText(/dans votre panier/)).toBeVisible();

    await page.goto("/commande");
    await page.locator('input[name="email"]').fill("jan@example.test");
    await page.locator('input[name="fullName"]').fill("Jan de Vries");
    await page.locator('input[name="line1"]').fill("Herengracht 1");
    await page.locator('input[name="postalCode"]').fill("1012 AB");
    await page.locator('input[name="locality"]').fill("Amsterdam");
    await selectCountry(page, "NL");
    await page.getByRole("button", { name: "Continuer" }).click();

    await expect(page.getByText("Comment livrons-nous ?")).toBeVisible();
  });
});

test.describe("delivery", () => {
  test("offers the French options and prices the chosen one", async ({
    page,
  }) => {
    await page.goto("/piece/collier-aurore");
    await page.getByRole("button", { name: "Ajouter au panier" }).click();
    await expect(page.getByText(/dans votre panier/)).toBeVisible();

    await page.goto("/commande");
    await page.locator('input[name="email"]').fill("camille@example.test");
    await page.locator('input[name="fullName"]').fill("Camille Dupont");
    await page.locator('input[name="line1"]').fill("12 rue des Orfèvres");
    await page.locator('input[name="postalCode"]').fill("75001");
    await page.locator('input[name="locality"]').fill("Paris");
    await page.getByRole("button", { name: "Continuer" }).click();

    await expect(page.getByText("Retrait à l'atelier")).toBeVisible();
    await expect(page.getByText("Colissimo suivi")).toBeVisible();

    // The cheapest is preselected, so the total on screen is true before the
    // buyer touches anything: free pickup, hence no delivery line.
    await expect(page.getByText("Offerte").first()).toBeVisible();

    await page.locator('input[value="colissimo"]').check();
    // 89,00 + 6,90 = 95,90, and the VAT contained in it is 15,98.
    await expect(page.getByText("95,90 €").first()).toBeVisible();
    await expect(page.getByText("15,98 €")).toBeVisible();
  });

  test("free delivery applies above the threshold", async ({ page }) => {
    // 690,00 € clears the 150,00 € free-delivery threshold.
    await page.goto("/piece/bague-nadir");
    await page.getByRole("button", { name: "Ajouter au panier" }).click();
    await expect(page.getByText(/dans votre panier/)).toBeVisible();

    await page.goto("/commande");
    await page.locator('input[name="email"]').fill("camille@example.test");
    await page.locator('input[name="fullName"]').fill("Camille Dupont");
    await page.locator('input[name="line1"]').fill("12 rue des Orfèvres");
    await page.locator('input[name="postalCode"]').fill("75001");
    await page.locator('input[name="locality"]').fill("Paris");
    await page.getByRole("button", { name: "Continuer" }).click();

    await page.locator('input[value="colissimo"]').check();
    // The rate is free for this cart, so the total is the goods alone.
    await expect(page.getByText("690 €").first()).toBeVisible();
  });
});

test.describe("payment and confirmation", () => {
  test("a paid order shows its total, its VAT and its invoice", async ({
    page,
  }) => {
    await buy(page, "collier-aurore", { shippingCode: "colissimo" });

    await expect(page.getByRole("heading", { name: "Merci" })).toBeVisible();
    await expect(page.getByText("Collier Aurore")).toBeVisible();
    await expect(page.getByText("95,90 €").first()).toBeVisible();
    await expect(page.getByText("15,98 €")).toBeVisible();

    // The statutory withdrawal notice belongs on the confirmation.
    await expect(page.getByText(/quatorze jours/)).toBeVisible();

    // The invoice is issued by a hook on `commerce:order:paid`, so it may land a
    // beat after the page.
    await expect(page.getByRole("link", { name: /Facture FA-/ })).toBeVisible();
  });

  test("the invoice carries every mention French law requires", async ({
    page,
  }) => {
    await buy(page, "boucles-eclipse", { shippingCode: "retrait" });
    // Assert where the link points before following it. When the invoice route
    // was not registered this test failed on the rendered 404 and said nothing
    // about the cause; the href is what distinguishes a bad link from a missing
    // route.
    const lien = page.getByRole("link", { name: /Facture FA-/ });
    await expect(lien).toHaveAttribute("href", /^\/facture\/FA-\d{4}-\d{6}$/);
    await lien.click();

    const invoice = page.locator("body");
    // Seller identity.
    await expect(invoice).toContainText("Atelier Aurore");
    await expect(invoice).toContainText("912 345 678 00012");
    await expect(invoice).toContainText("FR91234567800");
    // Buyer, lines, and the per-rate tax breakdown.
    await expect(invoice).toContainText("Camille Dupont");
    await expect(invoice).toContainText("Boucles Éclipse");
    await expect(invoice).toContainText("Total HT");
    await expect(invoice).toContainText("TVA 20 %");
    await expect(invoice).toContainText("Total TTC");
    await expect(invoice).toContainText("rétractation");
  });

  test("the cart is emptied, so a back button cannot re-buy it", async ({
    page,
  }) => {
    await buy(page, "collier-aurore", { shippingCode: "retrait" });

    await page.goto("/panier");
    await expect(
      page.getByRole("heading", { name: "Panier vide" }),
    ).toBeVisible();
  });

  test("paying an empty cart is refused before it starts", async ({ page }) => {
    await page.goto("/commande");
    await expect(
      page.getByRole("heading", { name: "Panier vide" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Payer" })).toHaveCount(0);
  });
});
