import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5174);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  reporter: process.env.CI ? "list" : "html",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    reuseExistingServer: !process.env.CI,
    command: "yarn start",
    url: `http://localhost:${port}`,
    env: {
      SERVER_PORT: String(port),
      DATABASE_URL: ":memory:",
    },
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
