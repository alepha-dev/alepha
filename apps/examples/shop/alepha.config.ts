import { defineConfig } from "alepha/cli/config";
import { devtools } from "alepha/cli/devtools";

/*
 * No `platform()` block: shop.alepha.dev is deployed through Lore by CI
 * (`deploy-shop-production`), which takes the domain from the
 * `shop / production` copy's pinned url and the variables from its Environment
 * tab, never from this file.
 */
export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. The two used to be the same number,
  // and a running `yarn dev` was then adopted by the e2e suite. Every app
  // without a `dev.port` binds 5173.
  dev: { port: 3305 },
  plugins: [
    /*
     * Dev-server only: the plugin is registered by the CLI, never by the app, so
     * nothing here reaches the deployed Worker. It mounts the inspector at
     * `/__devtools/` and injects the floating button into every dev page.
     */
    devtools(),
  ],
});
