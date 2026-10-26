import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  // The 33xx band is the dev servers', disjoint from the 4300-4999 e2e band
  // (`scripts/playwright.port.ts`); 3315 is this app's.
  dev: { port: 3315 },
});
