import { defineConfig, devices } from "@playwright/test";

import { e2ePort } from "../../../scripts/playwright.port.ts";

/*
 * Two servers: the app on the suite's e2e port, and the mock identity
 * provider of `alepha/testing/oidc` one port above it, inside the same slot
 * (slots are ten ports apart). CI therefore needs no Keycloak; the realm in
 * `keycloak/acme-realm.json` is what the mock imitates.
 */
const port = e2ePort("oidc");
const idpPort = port + 1;
const issuer = `http://127.0.0.1:${idpPort}/realms/acme`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalTimeout: 600_000,
  reporter: "list",
  fullyParallel: false,
  use: {
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${port}`,
  },
  webServer: [
    {
      reuseExistingServer: false,
      command: "node e2e/mock-idp.ts",
      url: `${issuer}/.well-known/openid-configuration`,
      timeout: 30_000,
      env: { IDP_PORT: `${idpPort}` },
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      reuseExistingServer: false,
      command: "yarn start:e2e",
      url: `http://localhost:${port}`,
      timeout: 180_000,
      env: {
        SERVER_PORT: `${port}`,
        OIDC_ISSUER: issuer,
        OIDC_CLIENT_ID: "acme-web",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
