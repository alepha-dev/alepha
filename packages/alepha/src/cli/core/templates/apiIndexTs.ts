export interface ApiIndexTsOptions {
  appName?: string;
}

export const apiIndexTs = (options: ApiIndexTsOptions = {}) => {
  const { appName = "app" } = options;

  return `
import { $module } from "alepha";
import { HelloController } from "./controllers/HelloController.ts";

export const ApiModule = $module({
  name: "${appName}.api",
  services: [HelloController],
});
`.trim();
};
