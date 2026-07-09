import { defineConfig, devices } from "@playwright/test";

const port = 3312;

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
