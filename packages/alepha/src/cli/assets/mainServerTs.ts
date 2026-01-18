export interface MainServerTsOptions {
  react?: boolean;
}

export const mainServerTs = (options: MainServerTsOptions = {}) => {
  const { react = false } = options;

  const webImport = react
    ? `import { WebModule } from "./web/index.ts";\n`
    : "";

  const webWith = react ? `alepha.with(WebModule);\n` : "";

  return `
import { Alepha, run } from "alepha";
import { ApiModule } from "./api/index.ts";
${webImport}
const alepha = Alepha.create();

alepha.with(ApiModule);
${webWith}
run(alepha);
`.trim();
};
