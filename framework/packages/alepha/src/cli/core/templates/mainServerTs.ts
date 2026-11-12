export interface MainServerTsOptions {
  /**
   * Whether the project has a web module. False only for Expo projects,
   * which bring their own client runtime.
   */
  react?: boolean;
  /**
   * Whether the app reports to Lore (`--infra lore`): `AlephaSigil` from
   * `@alepha/lore/sigil`, so telemetry is on from the first deploy.
   */
  sigil?: boolean;
}

export const mainServerTs = (options: MainServerTsOptions = {}) => {
  const { react = false, sigil = false } = options;

  const imports = [`import { ApiModule } from "./api/index.ts";`];
  const withs = [`alepha.with(ApiModule);`];

  if (sigil) {
    imports.unshift(`import { AlephaSigil } from "@alepha/lore/sigil";`);
    withs.unshift(`alepha.with(AlephaSigil);`);
  }

  if (react) {
    imports.push(`import { WebModule } from "./web/index.ts";`);
    withs.push(`alepha.with(WebModule);`);
  }

  return (
    `
import { Alepha, run } from "alepha";
import { helmetOptions } from "alepha/server";

${imports.join("\n")}

const alepha = Alepha.create();

// A strict Content Security Policy: no inline script the framework did not
// hash or nonce, no third-party host it was not told about. Allow a host with
// alepha.inject(ServerHelmetProvider).addCspSource("script-src", "https://...").
alepha.store.mut(helmetOptions, (old) => ({
  ...old,
  contentSecurityPolicy: {},
}));

${withs.join("\n")}

run(alepha);
`.trim() + "\n"
  );
};
