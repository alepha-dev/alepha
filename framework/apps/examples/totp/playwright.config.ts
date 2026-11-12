import { defineConfig, devices } from "@playwright/test";

import { e2ePort } from "../../../scripts/playwright.port.ts";

/*
 * Passkeys in a real browser: the Node build on a fresh SQLite file, and
 * Chromium's virtual authenticator over CDP. Chromium only: WebKit and
 * Firefox have no equivalent in Playwright.
 */
const port = e2ePort("totp");

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  globalTimeout: 600_000,
  reporter: "list",
  fullyParallel: false,
  workers: 1,
  use: {
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${port}`,
  },
  webServer: [
    {
      reuseExistingServer: false,
      command:
        "rm -rf node_modules/.e2e && mkdir -p node_modules/.e2e && yarn start:e2e",
      url: `http://localhost:${port}`,
      timeout: 180_000,
      env: { SERVER_PORT: `${port}` },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
