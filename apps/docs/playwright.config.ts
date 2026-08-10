import { defineConfig, devices } from "@playwright/test";
import { e2ePort } from "../../playwright.port.ts";

/*
 * 3302 sits in the same band as the other apps' e2e ports (lore 3303,
 * playground 3304, shop 3305, example-ssr 3311/3312). Never 5173/5174 — Vite's
 * default and its first fallback — because an unrelated dev server squatting
 * the port turns `reuseExistingServer: false` into a hard failure that looks
 * like a regression. `e2ePort` adds the `E2E_PORT` override and moves a linked
 * worktree off this port so two agents cannot share a server.
 */
const port = e2ePort(3302);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalTimeout: 600_000,
  reporter: "html",
  use: {
    screenshot: "only-on-failure",
    baseURL: `http://localhost:${port}`,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "yarn start",
    url: `http://localhost:${port}`,
    timeout: 120_000,
    env: {
      SERVER_PORT: `${port}`,
      // `yarn start` runs the production build (`node dist`), which now refuses
      // to boot on the default APP_SECRET — inject a test one.
      APP_SECRET: "e2e-test-secret",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
