import { defineConfig, devices } from "@playwright/test";

const port = 3302;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
    screenshot: "on",
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
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
    env: {
      SERVER_PORT: `${port}`,
    },
  },
});
