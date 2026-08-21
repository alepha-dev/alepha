import { defineConfig, devices } from "@playwright/test";

import { e2ePort } from "../../../playwright.port.ts";

/*
 * This config was the one that never got migrated: it hardcoded 3311, which is
 * this app's OWN dev port (`alepha.config.ts`) — so `yarn dev` in one terminal
 * and this suite in another fought over a single socket, and whichever lost
 * either failed to bind or silently served the other. It now allocates from the
 * reserved 4300-4999 e2e band like every other config; `yarn dev` below gets
 * the chosen port through `SERVER_PORT`, which outranks `dev.port`.
 */
const port = e2ePort("ssr-dev");

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
    // Never reuse a running server: the port is bind-tested free moments before
    // this starts, so anything answering here is not this run's server.
    reuseExistingServer: false,
    command: "yarn dev",
    url: `http://localhost:${port}`,
    timeout: 120_000,
    env: { SERVER_PORT: `${port}` },
    stdout: "pipe",
    stderr: "pipe",
  },
});
