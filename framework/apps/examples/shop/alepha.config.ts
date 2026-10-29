import { lore } from "@alepha/lore/cli";
import { defineConfig } from "alepha/cli/config";
import { infra } from "alepha/cli/infra";

/*
 * shop.alepha.dev is a demo: `deploy-shop-production` runs `alepha deploy` on
 * every green main, its data is disposable, and its secrets (APP_SECRET and
 * the Stripe test keys) come from the `shop-production` GitHub environment,
 * through the job env, and are sealed into its Lore copy on each deploy.
 */
export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. The two used to be the same number,
  // and a running `yarn dev` was then adopted by the e2e suite. Every app
  // without a `dev.port` binds 5173.
  dev: { port: 3305 },
  plugins: [
    infra({
      // Deployed by Lore (#Q2778), the way `docs/alepha.config.ts` is:
      // `lore()` names the copy `shop/production` (the package name and the
      // environment key) in Lore project `alepha`, and Lore derives the name
      // `alepha-shop-production` from the project slug, which is the name of
      // the Worker, D1 and bucket `shop.alepha.dev` already runs on (#Q2576),
      // so the first deploy takes them over in place. The domain is the copy's
      // `url` in Lore, not a field here.
      //
      // No infra-level `project` here: it would prefix the app name Lore
      // receives (`alepha-shop`), and Lore prefixes its own project slug on
      // top, giving `alepha-alepha-shop-production`: a new Worker and an empty
      // database.
      environments: {
        production: lore({ project: "alepha", estate: "cf-feunard" }),
      },
    }),
  ],
});
