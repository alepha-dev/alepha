import { defineConfig, devices } from "@playwright/test";

const port = 3303;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${3303}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "yarn start",
    url: `http://localhost:${3303}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
    env: {
      SERVER_PORT: `${port}`,
    },
  },
});
