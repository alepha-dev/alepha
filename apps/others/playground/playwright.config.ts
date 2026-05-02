import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5174);

export default defineConfig({
  testDir: "./e2e",
  reporter: process.env.CI ? "list" : "html",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    reuseExistingServer: !process.env.CI,
    command: "yarn dev",
    url: `http://localhost:${port}`,
    env: { SERVER_PORT: String(port) },
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
