import { defineConfig, devices } from "@playwright/test";

const port = 3302;

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
