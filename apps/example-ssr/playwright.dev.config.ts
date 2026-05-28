import { defineConfig, devices } from "@playwright/test";

const port = 3311;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalTimeout: 600_000,
  reporter: "html",
  use: {
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "dev",
      use: { baseURL: `http://localhost:${port}` },
      testIgnore: /prod\//,
    },
  ],
  webServer: {
    command: "yarn dev",
    url: `http://localhost:${port}`,
    timeout: 120_000,
    env: { SERVER_PORT: `${port}` },
    stdout: "pipe",
    stderr: "pipe",
  },
});
