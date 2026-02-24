export interface ApiIndexTsOptions {
  appName?: string;
  auth?: boolean;
}

export const apiIndexTs = (options: ApiIndexTsOptions = {}) => {
  const { appName = "app", auth = false } = options;

  const imports: string[] = ['import { $module } from "alepha";'];
  const services: string[] = [];

  if (auth) {
    imports.push('import { AppSecurity } from "./AppSecurity.ts";');
    services.push("AppSecurity");
  }

  imports.push(
    'import { HelloController } from "./controllers/HelloController.ts";',
  );
  services.push("HelloController");

  return `
${imports.join("\n")}

export const ApiModule = $module({
  name: "${appName}.api",
  services: [${services.join(", ")}],
});
`.trim();
};
