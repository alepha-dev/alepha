import { defineConfig, devices } from "@playwright/test";

const port = 3312;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
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
      reuseExistingServer: true,
      command: "yarn start:e2e",
      url: `http://localhost:${port}`,
      env: { SERVER_PORT: `${port}` },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
