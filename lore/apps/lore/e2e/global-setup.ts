import { chromium, type FullConfig } from "@playwright/test";

import { ADMIN_EMAIL, ADMIN_PASSWORD, registerAndVerify } from "./_helpers.ts";

/**
 * Register the realm admin once, before any spec runs.
 *
 * `playwright.config.ts` pins one `ADMIN_EMAIL` and `AppSecurityProvider`
 * promotes exactly that address, so the admin account is shared by every spec
 * that needs one - and an account can only be registered once against the one
 * server and one in-memory database the whole suite runs against.
 *
 * Doing it here rather than in each spec is what keeps `admin-analytics` and
 * `admin-user-detail` from racing to create it, and keeps a future third admin
 * spec from having to know either of them exists.
 */
export default async (config: FullConfig): Promise<void> => {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) {
    throw new Error("global-setup: no baseURL on the first project");
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await registerAndVerify(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await context.close();
  } finally {
    await browser.close();
  }
};
