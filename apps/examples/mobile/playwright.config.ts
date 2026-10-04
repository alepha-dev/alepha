import { defineConfig, devices } from "@playwright/test";

import { e2ePort } from "../../../scripts/playwright.port.ts";

/*
 * Two servers, two e2e ports, the way a native app sees them: the app shell
 * on one origin (what a WebView loads from `capacitor://localhost`) and the
 * API on another. Both ports come from the 4300-4999 e2e band through
 * `e2ePort`, never a dev port; `reuseExistingServer` is off, as everywhere.
 *
 * Playwright starts the two servers in order, each awaited, so the API is
 * built and listening before the shell is built against its URL. The two
 * builds share `node_modules/.alepha/`, which is why they must not overlap.
 */
const shellPort = e2ePort("mobile");
const apiPort = e2ePort("mobile-api");

export const API_URL = `http://localhost:${apiPort}`;

export default defineConfig({
  testDir: "./e2e",
  reporter: process.env.CI ? "list" : "html",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  globalTimeout: 600_000,
  expect: { timeout: process.env.CI ? 15_000 : 8_000 },
  use: {
    baseURL: `http://localhost:${shellPort}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      reuseExistingServer: false,
      command: "yarn build && node dist/index.node.js",
      url: `${API_URL}/api/hello`,
      timeout: 240_000,
      env: {
        SERVER_PORT: `${apiPort}`,
        DATABASE_URL: ":memory:",
        APP_SECRET: "e2e-secret-not-a-real-one",
        NODE_ENV: "development",
        // The shell's origin is the only browser origin this API admits
        // beyond the two native ones.
        MOBILE_CORS_ORIGINS: `http://localhost:${shellPort}`,
        MOBILE_API_STALL: "false",
      },
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      reuseExistingServer: false,
      command:
        "yarn alepha capacitor sync --web-only && node scripts/serve-shell.ts",
      url: `http://localhost:${shellPort}`,
      timeout: 240_000,
      env: {
        MOBILE_API_URL: API_URL,
        SHELL_PORT: `${shellPort}`,
      },
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
