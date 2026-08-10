import { defineConfig, devices } from "@playwright/test";
import { e2ePort } from "../../playwright.port.ts";

/*
 * 3312 sits in the same band as the other apps' e2e ports (docs 3302, lore
 * 3303, playground 3304, shop 3305). Never 5173/5174 — Vite's default and its
 * first fallback — because an unrelated dev server squatting the port turns
 * `reuseExistingServer: false` into a hard failure that looks like a
 * regression. `e2ePort` adds the `E2E_PORT` override and moves a linked
 * worktree off this port so two agents cannot share a server — which matters
 * here too: the comment on `webServer` below already knows a stale wrangler on
 * this port serves the whole suite a build that is not yours.
 */
const port = e2ePort(3312);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalTimeout: 600_000,
  reporter: "html",
  fullyParallel: false,
  use: {
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "prod",
      use: { baseURL: `http://localhost:${port}` },
    },
  ],
  webServer: [
    {
      // Fast inner loop locally, but never reuse under CI (`yarn verify` forces
      // CI=true) — a wrangler left behind by an interrupted run answers on this
      // port and would silently serve a stale build to the whole suite.
      reuseExistingServer: !process.env.CI,
      command: "yarn start:e2e",
      url: `http://localhost:${port}`,
      timeout: 180_000,
      env: { SERVER_PORT: `${port}` },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
