import { AlephaSigil } from "@alepha/lore/sigil";
import { Alepha, run } from "alepha";

import { UiShowcase } from "./showcase/index.ts";
import { UiWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "UI",
  },
});

/**
 * ⚠️ Split from `main.browser.ts` because of `UiShowcase`, and only because of
 * it. This app was written with a single `main.ts` first, on the reasoning that
 * one entry cannot register a module on one side and forget it on the other.
 * That is true and it is not worth the trade: `ShowcaseController` declares
 * `$action`s, `alepha/server`'s browser build does not export `$action`, and
 * the single entry pulled the controller into the browser bundle - which fails
 * at load with "does not provide an export named '$action'" and takes the whole
 * page with it. The browser never needs the controller: it resolves actions
 * through the registry and calls them over HTTP.
 *
 * `AlephaSigil` reports page views, Web Vitals and grouped errors to Lore, under
 * the `ui/production` copy of the `alepha` project. Lore mints its `SIGIL_KEY`
 * when it deploys the copy, because the module declares the key in the build
 * manifest. It is inert without the key and outside production, so dev and the
 * e2e suite send nothing. It sits in both entries: the browser half collects,
 * this half forwards from `POST /api/sigil/ingest`, where the key stays.
 */
alepha //
  .with(UiShowcase)
  .with(AlephaSigil)
  .with(UiWeb);

run(alepha);
