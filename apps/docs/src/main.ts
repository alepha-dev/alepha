import { Alepha, run } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";

import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create({
  env: {
    APP_NAME: "DOCS",
  },
});

/**
 * Every page is prerendered, so the deployed site is static assets and the
 * Worker beside them serves nothing a reader asks for (see the `assets` block
 * in `alepha.config.ts`).
 *
 * It reported page views and Web Vitals to Lore through `AlephaSigil` until
 * Lore left this repository (#E72): the reporter is gone with it, and comes
 * back with an umami-like tracker, not before.
 */
alepha //
  .with(AlephaReactI18n)
  .with(AppRouter);

run(alepha);
