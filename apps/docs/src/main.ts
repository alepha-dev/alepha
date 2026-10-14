import { AlephaSigil } from "@alepha/lore/sigil";
import { Alepha, run } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";

import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create({
  env: {
    APP_NAME: "DOCS",
  },
});

/**
 * `AlephaSigil` reports page views, Web Vitals and grouped errors to Lore, under
 * the `docs/production` sigil of the `Alepha` project. It is inert without
 * `SIGIL_KEY` and inert outside production, so dev and the e2e suite send
 * nothing.
 *
 * Every page is prerendered: the browser posts to this app's own
 * `POST /api/sigil/ingest`, the one route the Worker serves (see the `assets`
 * block in `alepha.config.ts`), which is where the visitor IP becomes a salted
 * daily hash and where the key stays.
 *
 * Only the runtime module comes from `@alepha/lore`. The deploy stays on
 * `cloudflare()`, not Lore's infra adapter, so a framework release never
 * depends on Lore to publish its docs (#Q2688).
 */
alepha //
  .with(AlephaReactI18n)
  .with(AlephaSigil)
  .with(AppRouter);

run(alepha);
