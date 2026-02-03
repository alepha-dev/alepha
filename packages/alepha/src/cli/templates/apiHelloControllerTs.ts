export interface ApiHelloControllerOptions {
  appName?: string;
}

export const apiHelloControllerTs = (
  options: ApiHelloControllerOptions = {},
) => {
  const appName = options.appName || "my-app";
  const appNameCapitalized = appName
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return `import { $action } from "alepha/server";
import { helloResponseSchema } from "../schemas/helloResponseSchema.ts";

export class HelloController {

  hello = $action({
    path: "/hello",
    schema: {
      response: helloResponseSchema,
    },
    handler: () => ({
      appName: "${appNameCapitalized}",
      serverTime: new Date().toISOString(),
    }),
  });
}
`.trim();
};
