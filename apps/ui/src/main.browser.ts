import { AlephaSigil } from "@alepha/lore/sigil";
import { Alepha, run } from "alepha";

import { UiWeb } from "./web/index.ts";

const alepha = Alepha.create({
  env: {
    APP_NAME: "UI",
  },
});

/**
 * No `UiShowcase` here, deliberately.
 *
 * The showcase's actions are server-side: `ShowcaseController` uses `$action`,
 * which `alepha/server` does not export in its browser build, so importing it
 * here fails at load and blanks the page. The browser does not need it - it
 * reads the action registry SSR seeded into the store and calls those actions
 * over HTTP, which is the same path any real Alepha app takes.
 */
alepha //
  .with(AlephaSigil)
  .with(UiWeb);

run(alepha);
