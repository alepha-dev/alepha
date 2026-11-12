import { AlephaSigil } from "@alepha/lore/sigil";
import { Alepha, run } from "alepha";
import { helmetOptions } from "alepha/server";

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
// The strict Content Security Policy (#E130): scripts by hash or per-request
// nonce, no 'unsafe-inline'. The e2e suite runs under it and fails on the
// first violation, so it stays true.
alepha.store.mut(helmetOptions, (old) => ({
  ...old,
  // Trusted Types too (#Q3320): the framework's DOM sinks go through its
  // `alepha` policy, and the suite fails on any other.
  contentSecurityPolicy: { trustedTypes: true },
}));

alepha //
  .with(UiShowcase)
  .with(AlephaSigil)
  .with(UiWeb);

run(alepha);
