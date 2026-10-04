import { defineConfig } from "alepha/cli/config";
import { cloudflare, platform } from "alepha/cli/platform";

/*
 * shop.alepha.dev is a demo: `deploy-shop-production` runs `platform up` on
 * every green main, its data is disposable, and its secrets (APP_SECRET and
 * the Stripe test keys) come from the `shop-production` GitHub environment.
 */
export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. The two used to be the same number,
  // and a running `yarn dev` was then adopted by the e2e suite. Every app
  // without a `dev.port` binds 5173.
  dev: { port: 3305 },
  plugins: [
    platform({
      // Worker, D1 and bucket `alepha-shop-production`: the names Lore Deploy
      // gave them, so the Custom Domain moved over without a 409 (#Q2576).
      project: "alepha",
      environments: {
        production: cloudflare({ domain: "shop.alepha.dev" }),
      },
    }),
  ],
});
