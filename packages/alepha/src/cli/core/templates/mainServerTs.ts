export interface MainServerTsOptions {
  /**
   * Whether the project has a web module. False only for Expo projects,
   * which bring their own client runtime.
   */
  react?: boolean;
}

export const mainServerTs = (options: MainServerTsOptions = {}) => {
  const { react = false } = options;

  const imports = [`import { ApiModule } from "./api/index.ts";`];
  const withs = [`alepha.with(ApiModule);`];

  if (react) {
    imports.push(`import { WebModule } from "./web/index.ts";`);
    withs.push(`alepha.with(WebModule);`);
  }

  return `
import { Alepha, run } from "alepha";
${imports.join("\n")}

const alepha = Alepha.create();

${withs.join("\n")}

run(alepha);
`.trim();
};
