export interface MainBrowserTsOptions {
  /**
   * Whether the app reports to Lore (`--infra lore`). The sigil's browser
   * half is what sends page views and Web Vitals, so it is mounted here as
   * well as in `main.server.ts`, as Lore's own app does (#Q3158).
   */
  sigil?: boolean;
}

export const mainBrowserTs = (options: MainBrowserTsOptions = {}) =>
  `
${options.sigil ? 'import { AlephaSigil } from "@alepha/lore/sigil";\n' : ""}import { Alepha, run } from "alepha";

import { WebModule } from "./web/index.ts";

const alepha = Alepha.create();

${options.sigil ? "alepha.with(AlephaSigil);\n" : ""}alepha.with(WebModule);

run(alepha);
`.trim() + "\n";
