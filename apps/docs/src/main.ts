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
 * the `docs/production` copy of the `Alepha` project. Lore mints its
 * `SIGIL_KEY` when it deploys the copy (#Q2701). It is inert without the key
 * and inert outside production, so dev and the e2e suite send nothing.
 *
 * Every page is prerendered: the browser posts to this app's own
 * `POST /api/sigil/ingest`, the one route the Worker serves (see the `assets`
 * block in `alepha.config.ts`), which is where the visitor IP becomes a salted
 * daily hash and where the key stays.
 */
alepha //
  .with(AlephaReactI18n)
  .with(AlephaSigil)
  .with(AppRouter);

run(alepha);
