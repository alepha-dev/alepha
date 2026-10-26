import { defineConfig, devices } from "@playwright/test";

import { e2ePort } from "../../../scripts/playwright.port.ts";

/*
 * The e2e port comes from the 4300-4999 band, reserved for e2e and disjoint
 * from every dev port (see `playwright.port.ts`). The server is the Node
 * build with the in-memory model scripted (`AI_E2E=1`, `E2eScript`), on a
 * fresh SQLite file.
 */
const port = e2ePort("ai");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalTimeout: 600_000,
  reporter: "list",
  fullyParallel: false,
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
