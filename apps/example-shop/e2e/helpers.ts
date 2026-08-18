import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Walk the funnel up to the PSP redirect and confirm the payment.
 *
 * Shared because five specs need a paid order and none of them is *about* the
 * funnel. Written against visible text rather than test ids on purpose: if the
 * button a customer must find stops saying "Payer", these tests should fail.
 */
export const buy = async (
  page: Page,
  slug: string,
  options: {
    country?: string;
    postalCode?: string;
    locality?: string;
    shippingCode?: string;
    email?: string;
  } = {},
) => {
  const {
    country = "FR",
    postalCode = "75001",
    locality = "Paris",
    shippingCode,
    email = "camille@example.test",
  } = options;

  await page.goto(`/produit/${slug}`);
  await page.getByRole("button", { name: "Ajouter au panier" }).click();
  // The toast is the signal the server accepted it — waiting on a timeout here is
  // what made the first exploratory pass flaky.
  await expect(page.getByText(/dans votre panier/)).toBeVisible();

  await page.goto("/commande");
  /*
   * Filled by `name`, not by label.
   *
   * `getByLabel("Adresse", { exact: true })` found nothing and took eight specs
   * down with it: a required field's `<label>` contains the asterisk, so its
   * accessible name is "Adresse *" and an exact match never lands. Non-exact
   * matching would work but is worse — "Adresse" is a prefix of other address
   * labels, so it would break the day a "Adresse de facturation" field appears.
   *
   * The `name` attribute is the field's identity and the controls set it. The
   * labels are still asserted, in the spec that is about the copy.
   */
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="fullName"]').fill("Camille Dupont");
  await page.locator('input[name="line1"]').fill("12 rue des Orfèvres");
  await page.locator('input[name="postalCode"]').fill(postalCode);
  await page.locator('input[name="locality"]').fill(locality);
  if (country !== "FR") {
    await selectCountry(page, country);
  }
  await page.getByRole("button", { name: "Continuer" }).click();

  // Step 2 — delivery.
  await expect(page.getByText("Comment livrons-nous ?")).toBeVisible();
  if (shippingCode) {
    await page.locator(`input[value="${shippingCode}"]`).check();
  }
  await page.getByRole("button", { name: "Continuer" }).click();

  // Step 3 — pay, which redirects to the mock PSP.
  await page.getByRole("button", { name: "Payer" }).click();
  await page.waitForURL(/\/payments\/mock-checkout\//);
  await page.getByRole("button", { name: /Pay|Confirm|Payer/ }).click();

  await page.waitForURL(/\/commande\/[0-9a-f-]{36}/);
  return page.url();
};

/** The country picker is a combobox, so it needs opening before selecting. */
export const selectCountry = async (page: Page, code: string) => {
  const labels: Record<string, string> = {
    BE: "Belgique",
    DE: "Allemagne",
    NL: "Pays-Bas",
    IT: "Italie",
    ES: "Espagne",
  };
  await page.getByLabel("Pays").click();
  await page.getByRole("option", { name: labels[code] ?? code }).click();
};

const ADMIN_EMAIL = "contact@atelier-aurore.test";
const ADMIN_PASSWORD = "atelier2026";

/**
 * Land signed in as the seeded administrator.
 *
 * The account is promoted by `adminEmails` at **session creation**, not at
 * registration — so going through a form, which opens a session, is what grants
 * the role. A direct API register leaves the account as a plain user.
 *
 * ### Sign in first, register only if that fails
 *
 * The first version registered first and fell back to signing in when the
 * "Create account" button was absent. That button is never absent: it is on the
 * registration page whether or not the account exists. So every spec after the
 * first re-submitted a registration for an address already taken, got "these
 * registration details are not available", and waited sixty seconds for a
 * navigation that was never coming. Nine admin specs, nine minutes, one cause —
 * and every failure pointed at the editor, which was fine.
 *
 * Signing in is the common path: the database is in memory, so exactly one spec
 * per run finds no account, and Playwright gives every test a fresh context with
 * no cookie, so all the others must sign in anyway.
 */
export const signInAsAdmin = async (page: Page) => {
  /*
   * The two forms do not name the account field the same way, and it matters:
   * sign-in calls it `identifier` (it accepts a username or a phone number in
   * realms that allow them), registration calls it `email`. Filling
   * `input[name="email"]` on the sign-in page waits sixty seconds for an element
   * that is not there — which is exactly how this helper failed the first time.
   */
  await submitCredentials(page, {
    path: "/auth/login",
    account: "identifier",
    submit: /Sign in|Se connecter/,
  });
  if (await reachesAdmin(page)) {
    return;
  }
  await submitCredentials(page, {
    path: "/auth/register",
    account: "email",
    submit: /Create account|Créer mon compte/,
  });
  if (await reachesAdmin(page)) {
    return;
  }
  throw new Error(
    `Could not sign in as ${ADMIN_EMAIL}: neither the sign-in form nor the registration form led to the back office.`,
  );
};

interface CredentialsForm {
  path: string;
  /** The `name` attribute of the field that takes the address. */
  account: string;
  submit: RegExp;
}

const submitCredentials = async (
  page: Page,
  form: CredentialsForm,
): Promise<void> => {
  await page.goto(form.path);
  await page.locator(`input[name="${form.account}"]`).fill(ADMIN_EMAIL);
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: form.submit }).click();
  // Leaving the form is the success signal, and a failure to leave is not an
  // error here — on the first spec of a run the sign-in legitimately fails
  // because the account does not exist yet. Whether we actually arrived is
  // settled by `reachesAdmin`, which asks the application instead of guessing
  // which page auth chose to land on.
  await page
    .waitForURL((url) => !url.pathname.startsWith("/auth/"), {
      timeout: 10_000,
    })
    .catch(() => undefined);
};

/**
 * The postcondition that actually matters, asked of the application itself: the
 * back office keeps us. An unauthorised visitor is bounced to sign-in by the
 * `/admin` loader, so staying on the URL *is* the permission check.
 */
const reachesAdmin = async (page: Page): Promise<boolean> => {
  await page.goto("/admin/produits");
  /*
   * Wait for the outcome instead of reading the URL.
   *
   * The `/admin` loader redirects by throwing `Redirection`, and the router
   * applies that *after* `page.goto` has resolved — so a visitor who is about to
   * be bounced still reads `/admin/produits` for a moment. The first version
   * believed it, reported success, and skipped the registration that was the
   * whole point; the specs then failed one by one on the sign-in page.
   *
   * Racing the two possible ends is both correct and quick: whichever of the
   * table and the sign-in button appears settles it.
   */
  const table = page.getByRole("table");
  const signIn = page.getByRole("button", { name: /Sign in|Se connecter/ });
  await expect(table.or(signIn)).toBeVisible();
  return table.isVisible();
};
