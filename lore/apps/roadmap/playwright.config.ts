import { defineConfig, devices } from "@playwright/test";

const port = 3303;

export default defineConfig({
  testDir: "./e2e",
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
    timeout: 120_000,
    command: "yarn start",
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    env: {
      SERVER_PORT: `${port}`,
    },
  },
});
