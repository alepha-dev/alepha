import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  // Dev ports live in the 33xx band, disjoint from the 4300-4999 e2e band.
  // The Keycloak realm in `keycloak/acme-realm.json` allows this port as a
  // redirect URI, so moving it means editing the realm too.
  dev: { port: 3316 },
});
