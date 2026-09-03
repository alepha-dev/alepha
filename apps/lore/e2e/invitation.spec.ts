import fs from "node:fs";

import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  extractCode,
  extractInviteUrl,
  findLatestEmail,
  newUserContext,
  registerAndVerify,
} from "./_helpers.ts";

test.describe("Invitation flow (in-app inbox)", () => {
  test("owner invites → invitee finds invite in profile inbox → accepts → joins as member", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const aEmail = `inviter-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const projectTitle = `Inv${Date.now()}`.slice(0, 20);
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const b = await newUserContext(browser, baseURL!, "invitee");
    try {
      await page.goto(`/${projectSlug}/settings/members`);
      await page.waitForLoadState("domcontentloaded");
      await page.getByRole("button", { name: /^invite$/i }).click();
      await expect(
        page.getByRole("heading", { name: /invite a user/i }),
      ).toBeVisible();
      await page.getByPlaceholder("user@example.com").fill(b.email);
      const createResp = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith("/api/invitations"),
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: /send invitation/i }).click();
      expect((await createResp).ok()).toBe(true);

      // The invitee opens their profile inbox — no link needed, the
      // invite is bound to their (verified) email.
      await b.page.goto("/account/invitations");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(projectTitle).first()).toBeVisible({
        timeout: 10_000,
      });

      const acceptResp = b.page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
        { timeout: 15_000 },
      );
      await b.page.getByRole("button", { name: /^accept$/i }).click();
      expect((await acceptResp).ok()).toBe(true);

      await b.page.waitForURL(new RegExp(`/${projectSlug}`), {
        timeout: 10_000,
      });

      await b.page.goto("/");
      await expect(b.page.getByText(projectTitle).first()).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await b.ctx.close();
    }
  });

  /**
   * The path this whole epic exists for: somebody with no account at all,
   * arriving from the invite mail.
   *
   * Driven from the LINK rather than the inbox, because the inbox is only
   * reachable once you already have an account and the whole point of the
   * token is the case where you do not.
   *
   * ⚠️ The realm is OPEN here, and has to be: the suite's other specs all
   * register, and flipping `registrationAllowed` is a global that would race
   * them. What the closed realm adds is `AuthRegister`'s `preAuthorized`
   * overriding its own alert; everything below (the token resolving, the
   * locked address, the redirect, the membership) is identical either way,
   * and the server-side half is covered by the closed-realm specs in
   * `RegistrationService.spec.ts`.
   */
  test("a stranger with no account joins through the link in the invite mail", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const aEmail = `linkinviter-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const projectTitle = `Lnk${Date.now()}`.slice(0, 20);
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    // Never registered, so there is no account behind this address and the
    // only way in is the link.
    const guestEmail = `linkguest-${Date.now()}@example.com`;

    await page.goto(`/${projectSlug}/settings/members`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("user@example.com").fill(guestEmail);
    const sentAfter = Date.now();
    const createResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    expect((await createResp).ok()).toBe(true);

    // The mail is queued by a fire-and-forget job, same as the verification
    // one, so poll generously rather than reading once.
    const invitePath = await findLatestEmail(guestEmail, 20_000, sentAfter);
    expect(invitePath).not.toBeNull();
    const inviteUrl = extractInviteUrl(fs.readFileSync(invitePath!, "utf-8"));
    expect(inviteUrl).not.toBeNull();

    const guest = await browser.newContext({ baseURL });
    try {
      const g = await guest.newPage();
      await g.goto(inviteUrl!);
      await g.waitForLoadState("domcontentloaded");

      // The address is pre-filled and not editable: the token is bound to
      // exactly this one, and letting it be typed over only produces a
      // server-side refusal the visitor cannot act on.
      const emailField = g.getByRole("textbox", {
        name: "Email",
        exact: true,
      });
      await expect(emailField).toHaveValue(guestEmail, { timeout: 15_000 });
      await expect(emailField).toBeDisabled();
      await expect(g.getByText(projectTitle).first()).toBeVisible();

      const passwordField = g.getByRole("textbox", {
        name: "Password",
        exact: true,
      });
      await expect(async () => {
        await passwordField.fill("GoodPassw0rd");
        await expect(passwordField).toHaveValue("GoodPassw0rd");
      }).toPass({ timeout: 15_000 });

      const submit = g.getByRole("button", { name: /create account/i });
      await expect(submit).toBeEnabled({ timeout: 30_000 });
      const registeredAfter = Date.now();
      await submit.click();

      // ⚠️ The verification step still runs HERE, and that is correct: the
      // pre-authorization seam is consulted only when the realm is closed,
      // and this suite's realm is open (see the note on this test). On a
      // closed realm the token stands in for the code and no second mail is
      // sent at all - proven in `RegistrationService.spec.ts`, "should skip
      // the verification mail when the seam vouches for the address", which
      // is the only place that can close a realm without racing the suite.
      await expect(
        g.getByRole("button", { name: /complete registration/i }),
      ).toBeVisible({ timeout: 15_000 });
      const codePath = await findLatestEmail(
        guestEmail,
        20_000,
        registeredAfter,
      );
      expect(codePath).not.toBeNull();
      const code = extractCode(fs.readFileSync(codePath!, "utf-8"));
      expect(code).not.toBeNull();
      await g.locator("#emailCode").fill(code!);
      await g.getByRole("button", { name: /complete registration/i }).click();

      // The flow lands on the invitations inbox rather than joining silently.
      // Joining a project is worth a click, and this is the one destination
      // both the credentials and the OAuth paths can reach.
      await g.waitForURL(/\/account\/invitations/, { timeout: 20_000 });
      await expect(g.getByText(projectTitle).first()).toBeVisible({
        timeout: 15_000,
      });

      const acceptResp = g.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
        { timeout: 15_000 },
      );
      await g.getByRole("button", { name: /^accept$/i }).click();
      expect((await acceptResp).ok()).toBe(true);

      await g.waitForURL(new RegExp(`/${projectSlug}`), { timeout: 15_000 });

      // A member now, and the owner's settings page agrees.
      await g.goto("/");
      await expect(g.getByText(projectTitle).first()).toBeVisible({
        timeout: 15_000,
      });

      // The link is spent: the invitation is no longer pending, so the same
      // URL cannot mint a second account.
      const g2 = await guest.newPage();
      await g2.goto(inviteUrl!);
      await g2.waitForLoadState("domcontentloaded");
      await expect(g2.getByText(/already been accepted/i).first()).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await guest.close();
    }
  });

  test("an invite link for an address that already has an account sends them to sign in", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const aEmail = `existinviter-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const projectTitle = `Exi${Date.now()}`.slice(0, 20);
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const b = await newUserContext(browser, baseURL!, "existing");
    try {
      await page.goto(`/${projectSlug}/settings/members`);
      await page.waitForLoadState("domcontentloaded");
      await page.getByRole("button", { name: /^invite$/i }).click();
      await page.getByPlaceholder("user@example.com").fill(b.email);
      const sentAfter = Date.now();
      const createResp = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith("/api/invitations"),
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: /send invitation/i }).click();
      expect((await createResp).ok()).toBe(true);

      const invitePath = await findLatestEmail(b.email, 20_000, sentAfter);
      expect(invitePath).not.toBeNull();
      const inviteUrl = extractInviteUrl(fs.readFileSync(invitePath!, "utf-8"));
      expect(inviteUrl).not.toBeNull();

      // Same single link, opened in a browser with no session. It must NOT
      // offer a register form: with `verifyEmailRequired`, submitting one for
      // a taken address mints a decoy intent and asks for a code that was
      // never sent.
      const stranger = await browser.newContext({ baseURL });
      try {
        const s = await stranger.newPage();
        await s.goto(inviteUrl!);
        await s.waitForLoadState("domcontentloaded");
        await expect(
          s.getByText(/already have an account/i).first(),
        ).toBeVisible({ timeout: 15_000 });
        await expect(
          s.getByRole("button", { name: /create account/i }),
        ).toHaveCount(0);
      } finally {
        await stranger.close();
      }

      // And the invitation is still waiting where it always was.
      await b.page.goto("/account/invitations");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(projectTitle).first()).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await b.ctx.close();
    }
  });

  test("invitee can decline from the profile inbox", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const aEmail = `inviter-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const projectTitle = `Dec${Date.now()}`.slice(0, 20);
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const b = await newUserContext(browser, baseURL!, "decliner");
    try {
      await page.goto(`/${projectSlug}/settings/members`);
      await page.waitForLoadState("domcontentloaded");
      await page.getByRole("button", { name: /^invite$/i }).click();
      await page.getByPlaceholder("user@example.com").fill(b.email);
      const createResp = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith("/api/invitations"),
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: /send invitation/i }).click();
      expect((await createResp).ok()).toBe(true);

      await b.page.goto("/account/invitations");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(projectTitle).first()).toBeVisible({
        timeout: 10_000,
      });

      const declineResp = b.page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/invitations\/[^/]+\/decline$/.test(r.url()),
        { timeout: 15_000 },
      );
      await b.page.getByRole("button", { name: /^decline$/i }).click();
      expect((await declineResp).ok()).toBe(true);

      // After decline, the inbox is empty and the project is not in the
      // user's home list.
      await expect(b.page.getByText(projectTitle)).toHaveCount(0);
      await b.page.goto("/");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(projectTitle)).toHaveCount(0);
    } finally {
      await b.ctx.close();
    }
  });

  test("invitation is bound to the invited email — strangers see an empty inbox", async ({
    page,
    browser,
    baseURL,
  }) => {
    // Invitation goes to one address; a different account opens its
    // inbox and sees nothing.
    test.setTimeout(120_000);

    const aEmail = `inviter-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const projectTitle = `Bnd${Date.now()}`.slice(0, 20);
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const invitedEmail = `target-${Date.now()}@example.com`;
    await page.goto(`/${projectSlug}/settings/members`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("user@example.com").fill(invitedEmail);
    const createResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    expect((await createResp).ok()).toBe(true);

    // A different account checks the inbox.
    const b = await newUserContext(browser, baseURL!, "stranger");
    try {
      await b.page.goto("/account/invitations");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(/no pending invitations/i)).toBeVisible({
        timeout: 10_000,
      });
      await expect(b.page.getByText(projectTitle)).toHaveCount(0);
    } finally {
      await b.ctx.close();
    }
  });

  test("inviting the same email twice surfaces an error", async ({ page }) => {
    test.setTimeout(90_000);
    const aEmail = `inviter-${Date.now()}@example.com`;
    const target = `dup-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      `Dup${Date.now()}`.slice(0, 20),
    );

    await page.goto(`/${projectSlug}/settings/members`);
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("user@example.com").fill(target);
    const firstResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    expect((await firstResp).ok()).toBe(true);

    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("user@example.com").fill(target);
    const secondResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    const second = await secondResp;
    expect(second.ok()).toBe(false);
    expect(second.status()).toBeGreaterThanOrEqual(400);
  });

  test("self-invite is blocked by the server", async ({ page }) => {
    test.setTimeout(90_000);
    const aEmail = `selfinv-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      `Slf${Date.now()}`.slice(0, 20),
    );

    await page.goto(`/${projectSlug}/settings/members`);
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("user@example.com").fill(aEmail);
    const resp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    const result = await resp;
    expect(result.ok()).toBe(false);
    expect(result.status()).toBeGreaterThanOrEqual(400);
  });

  test("owner revokes a pending invitation and the invitee's inbox empties", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const aEmail = `revoker-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const projectTitle = `Rev${Date.now()}`.slice(0, 20);
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const b = await newUserContext(browser, baseURL!, "revokee");
    try {
      await page.goto(`/${projectSlug}/settings/members`);
      await page.waitForLoadState("domcontentloaded");
      await page.getByRole("button", { name: /^invite$/i }).click();
      await page.getByPlaceholder("user@example.com").fill(b.email);
      const createResp = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith("/api/invitations"),
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: /send invitation/i }).click();
      expect((await createResp).ok()).toBe(true);
      await expect(page.getByText(b.email).first()).toBeVisible({
        timeout: 10_000,
      });

      // The invitee can see it before the owner takes it back — otherwise
      // the assertion after the revoke would pass on an invitation that
      // never arrived.
      await b.page.goto("/account/invitations");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(projectTitle).first()).toBeVisible({
        timeout: 10_000,
      });

      const revokeResp = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/invitations\/project\/\d+\/[^/]+\/revoke$/.test(r.url()),
        { timeout: 15_000 },
      );
      // Two clicks to reach it since #1695: the inline × became an item in
      // the same three-dots menu the member cards carry, so both card kinds
      // offer their destructive action in one shape.
      await page.getByTestId("invitation-actions").click();
      await page.getByTestId("revoke-invitation").click();
      await page.getByRole("button", { name: /^revoke$/i }).click();
      expect((await revokeResp).ok()).toBe(true);

      // The row is gone from the settings page, which re-runs its loader.
      await expect(page.getByText(b.email)).toHaveCount(0, {
        timeout: 10_000,
      });

      // And the token is dead, not merely hidden from the owner: the
      // invitee's inbox no longer offers it.
      await b.page.goto("/account/invitations");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(projectTitle)).toHaveCount(0, {
        timeout: 10_000,
      });
    } finally {
      await b.ctx.close();
    }
  });
});
