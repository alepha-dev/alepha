export interface WebIndexTsOptions {
  appName?: string;
}

export const webIndexTs = (options: WebIndexTsOptions = {}) => {
  const { appName = "app" } = options;

  return `
import { $module } from "alepha";
import { AppRouter } from "./AppRouter.ts";

export const WebModule = $module({
  name: "${appName}.web",
  services: [AppRouter],
});
`.trim();
};
