import { createHmac, randomUUID } from "node:crypto";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";

/*
 * Passkeys in a real browser, Chromium only: the virtual authenticator of
 * CDP (`WebAuthn.addVirtualAuthenticator`, ctap2, internal transport,
 * resident keys and user verification) plays Touch ID. What no unit spec
 * proves is proven here: that `navigator.credentials` accepts the server's
 * options and the server accepts the browser's answer, against the page's
 * real origin.
 *
 * One account walks the whole story, in order: add a passkey (a wrong
 * password first), sign in with the button, with the autofill, with the
 * password alone, clear the TOTP step with the passkey, remove it.
 */
test.describe.configure({ mode: "serial" });

const username = `pk${randomUUID().slice(0, 8)}`;
const password = "Passkey-e2e-123";
let totpSecret = "";

/**
 * A virtual authenticator for the context's pages, shared across tests so
 * the passkey added in the first one is still on the device.
 */
let context: BrowserContext;
let page: Page;

/**
 * Whether passkey options may be fetched. The virtual authenticator answers
 * the login page's autofill request on its own, as soon as the page loads,
 * so a scenario that is about something else (the button, the password)
 * holds the options back until it means to run a ceremony.
 */
let optionsAllowed = true;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.route("**/_auth/passkey/options**", (route) =>
    optionsAllowed ? route.continue() : route.abort(),
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
});

test.afterAll(async () => {
  await context.close();
});

const signOut = async () => {
  await context.clearCookies();
};

const signInWithPassword = async () => {
  await page.goto("/auth/login");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
};

const totp = (secret: string, offset = 0): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "")) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const mac = createHmac("sha1", key).update(counter).digest();
  const at = mac[mac.length - 1]! & 0x0f;
  const code = (mac.readUInt32BE(at) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
};

const typeCode = async (code: string) => {
  await page.locator('input[autocomplete="one-time-code"]').first().fill(code);
};

test("registers, then adds a passkey once the current password is right", async () => {
  await page.goto("/auth/register");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).not.toHaveURL(/\/auth\/register/);

  await signInWithPassword();
  await expect(page).not.toHaveURL(/\/auth\/login/);

  await page.goto("/account/security");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Add a passkey" })
    .click();

  const proof = page.getByRole("dialog");
  await proof
    .getByRole("textbox", { name: "Current password" })
    .fill("wrong-password");
  await proof.getByRole("button", { name: "Continue" }).click();
  await expect(proof.getByText("Current password is incorrect")).toBeVisible();

  await proof.getByRole("textbox", { name: "Current password" }).fill(password);
  await proof.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("Synced").or(page.getByText(/never used/)),
  ).toBeVisible();
});

test("signs in with the passkey button, no username typed", async () => {
  await signOut();
  optionsAllowed = false;
  await page.goto("/auth/login");
  // The autofill request is refused while held back; the button runs its own.
  await expect(page.getByRole("alert")).toBeVisible();
  optionsAllowed = true;
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
});

test("signs in through the identifier's autofill", async () => {
  await signOut();
  await page.goto("/auth/login");
  // The conditional request is pending on load; the virtual authenticator
  // answers it once the field is focused, as a user picking the passkey.
  await page.getByRole("textbox", { name: "Username" }).focus();
  await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: "Account menu" }),
  ).toBeVisible();
});

test("signs in with the password alone: a passkey raises no step", async () => {
  await signOut();
  optionsAllowed = false;
  await signInWithPassword();
  await expect(page).not.toHaveURL(/\/auth\/login/);
  await expect(page.getByText("Use a passkey")).toHaveCount(0);
});

test("clears the TOTP step with the passkey, the code field beside it", async () => {
  await page.goto("/account/security");
  await page.getByRole("button", { name: "Set up" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Cannot scan the code?").click();
  totpSecret = (await dialog
    .locator("p.font-mono")
    .first()
    .textContent())!.trim();
  await typeCode(totp(totpSecret));
  await expect(dialog.getByText("Save your recovery codes")).toBeVisible();
  await page.keyboard.press("Escape");

  await signOut();
  optionsAllowed = false;
  await signInWithPassword();
  await expect(page.getByRole("button", { name: "Verify" })).toBeVisible();
  optionsAllowed = true;
  await page.getByRole("button", { name: "Use a passkey" }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
});

test("removes the passkey with the current password, and its sign-in is refused", async () => {
  await page.goto("/account/security");
  // The passkey keeps the name the card pre-filled from the user agent.
  const removePasskey = page.getByRole("button", { name: /^Remove Chrome/ });
  await removePasskey.click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove" })
    .click();
  const proof = page.getByRole("dialog");
  await proof.getByRole("textbox", { name: "Current password" }).fill(password);
  // Wait for the write itself: while a dialog is open the page behind it is
  // aria-hidden, so the row reads as gone before the DELETE has even left.
  const removed = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().includes("/passkeys/"),
  );
  await proof.getByRole("button", { name: "Continue" }).click();
  expect((await removed).status()).toBe(200);
  await expect(proof).toBeHidden();
  await expect(removePasskey).toHaveCount(0);

  await signOut();
  await page.goto("/auth/login");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(
    page.getByText("That passkey could not sign you in."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/login/);
});
