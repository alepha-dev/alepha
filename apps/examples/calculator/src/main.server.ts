import { Alepha, run } from "alepha";

import { WebModule } from "./web/index.ts";

/**
 * Only for `alepha dev` in a browser, which renders the page on a server. The
 * native app ships no server: `alepha capacitor sync` bundles the shell.
 */
const alepha = Alepha.create();

alepha.with(WebModule);

run(alepha);
