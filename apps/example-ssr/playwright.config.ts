import { defineConfig, devices } from "@playwright/test";

const port = 3301;

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
    command: "yarn start",
    url: `http://localhost:${port}`,
    env: {
      SERVER_PORT: `${port}`,
    },
  },
});
