export interface MainServerTsOptions {
  api?: boolean;
  react?: boolean;
}

export const mainServerTs = (options: MainServerTsOptions = {}) => {
  const { api = false, react = false } = options;

  const imports: string[] = [];
  const withs: string[] = [];

  if (api) {
    imports.push(`import { ApiModule } from "./api/index.ts";`);
    withs.push(`alepha.with(ApiModule);`);
  }

  if (react) {
    imports.push(`import { WebModule } from "./web/index.ts";`);
    withs.push(`alepha.with(WebModule);`);
  }

  const importsBlock = imports.length > 0 ? `${imports.join("\n")}\n` : "";
  const withsBlock = withs.length > 0 ? `\n${withs.join("\n")}` : "";

  return `
import { Alepha, run } from "alepha";
${importsBlock}
const alepha = Alepha.create();
${withsBlock}

run(alepha);
`.trim();
};
