import { AlephaSigil } from "@alepha/sigil";
import { Alepha, run } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";
import { AppRouter } from "./AppRouter.tsx";

const alepha = Alepha.create({
  env: {
    APP_NAME: "DOCS",
  },
});

/**
 * `AlephaSigil` reports page views, Web Vitals and grouped errors to the sink
 * named by `SIGIL_SINK` (defaulting to the public Lore instance), under the
 * `docs-production` sigil of the `Alepha` project. It is inert without
 * `SIGIL_KEY` and inert outside production, so dev and the e2e suite send
 * nothing.
 *
 * It is also the reason this otherwise-static site is deployed as a Worker with
 * static assets rather than as plain files: the browser posts to the app's own
 * `POST /api/sigil/ingest`, which is where the visitor's IP becomes a salted
 * daily hash and where the credential stays. A purely static host can offer
 * neither, and posting straight to the sink would mean shipping the key to
 * every reader.
 */
alepha //
  .with(AlephaReactI18n)
  .with(AlephaSigil)
  .with(AppRouter);

run(alepha);
