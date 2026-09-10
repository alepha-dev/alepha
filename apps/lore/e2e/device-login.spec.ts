import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { registerAndVerify, submitSignInForm } from "./_helpers.ts";

/**
 * `lore login`, from the human's side (#Q2217).
 *
 * The CLI prints a code and a link, and somebody approves it in a browser.
 * Nothing served that link until this spec's quest: the framework advertised a
 * page it did not have, and the CLI's own specs fake the server, so no code was
 * ever approved for real. The device half here goes through Playwright's
 * isolated `request` fixture, the way the CLI talks to Lore - never through the
 * page, whose `fetch` carries the session.
 */
test.describe("Device login", () => {
  const password = "GoodPassw0rd";

  /**
   * What `lore login` does first.
   */
  const start = async (request: APIRequestContext) => {
    const res = await request.post("/oauth/device_authorization", {
      data: { client_id: "alepha-cli", scope: "mcp" },
    });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
    };
  };

  /**
   * One poll, as the CLI makes it once the human has answered.
   */
  const poll = async (request: APIRequestContext, deviceCode: string) => {
    const res = await request.post("/oauth/token", {
      data: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: "alepha-cli",
      },
    });
    return {
      status: res.status(),
      body: (await res.json()) as Record<string, string>,
    };
  };

  test("a signed-out human signs in on the way and approves the code", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const email = `device-${Date.now()}@example.com`;
    await registerAndVerify(page, email, password);
    // An account, but no session: the state of someone clicking the link
    // their terminal just printed, in a browser they are not signed in to.
    await page.context().clearCookies();

    const device = await start(request);
    await page.goto(device.verification_uri_complete);

    await page.waitForURL(/\/auth\/login/);
    await submitSignInForm(page, email, password);

    // Back on the page the link named, code and all - through the login
    // loader's bridge and `/oauth/continue`, both of which only knew
    // `/oauth/authorize` before.
    await page.waitForURL(/\/oauth\/device\?user_code=/, { timeout: 15_000 });
    await expect(page.getByText(device.user_code)).toBeVisible();
    await expect(page.getByText("Your projects")).toBeVisible();

    await page.getByRole("button", { name: "Allow" }).click();
    await expect(
      page.getByRole("heading", { name: "Device connected" }),
    ).toBeVisible();

    const granted = await poll(request, device.device_code);
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);

    // The token acts as the human who approved it, and as nobody else.
    const me = await request.get("/api/users/me", {
      headers: { authorization: `Bearer ${granted.body.access_token}` },
    });
    expect(me.ok(), await me.text()).toBe(true);
    expect(((await me.json()) as { email: string }).email).toBe(email);
  });

  test("a signed-in human types the code by hand and denies it", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await registerAndVerify(
      page,
      `device-deny-${Date.now()}@example.com`,
      password,
    );

    const device = await start(request);
    // The bare `verification_uri`, for whoever cannot follow the link.
    await page.goto(device.verification_uri);

    // Typed the way a person reads it off another screen: lower case, no
    // dash. Case and separators carry no meaning.
    await page
      .getByRole("textbox", { name: "Code" })
      .fill(device.user_code.toLowerCase().replace("-", ""));
    await page.getByRole("button", { name: "Continue" }).click();

    // The canonical form, to compare with the device.
    await expect(page.getByText(device.user_code)).toBeVisible();

    await page.getByRole("button", { name: "Deny" }).click();
    await expect(
      page.getByRole("heading", { name: "Request denied" }),
    ).toBeVisible();

    const refused = await poll(request, device.device_code);
    expect(refused.body.error).toBe("access_denied");
  });
});
