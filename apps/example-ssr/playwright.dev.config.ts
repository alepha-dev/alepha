import { defineConfig, devices } from "@playwright/test";

const port = 3311;

export default defineConfig({
  testDir: "./e2e",
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
    env: { SERVER_PORT: `${port}` },
    stdout: "pipe",
    stderr: "pipe",
  },
});
