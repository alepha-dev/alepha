import { defineConfig, devices } from "@playwright/test";

const port = 3303;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalTimeout: 600_000,
  outputDir: ".playwright/results",
  reporter: [["html", { outputFolder: ".playwright/report", open: "never" }]],
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
      // Cloudflare Turnstile "always-pass" test keys — `yarn start` runs `node dist`
      // which doesn't load `.env`, so e2e needs these injected explicitly.
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      // Lift the per-IP registration cap — the full suite registers dozens
      // of users from a single localhost IP. Default 10 trips mid-run.
      REGISTRATION_IP_MAX_ATTEMPTS: "1000",
      // Fixed admin email so the admin-user-detail spec can register an
      // account and have it auto-promoted to `admin` on first login.
      ADMIN_EMAIL: "admin@example.com",
    },
  },
});
