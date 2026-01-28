export const apiHelloControllerTs = () =>
  `
import { t } from "alepha";
import { $action } from "alepha/server";

export class HelloController {
  hello = $action({
    path: "/hello",
    schema: {
      response: t.object({
        message: t.string(),
      }),
    },
    handler: () => ({
      message: "Hello, Alepha!",
    }),
  });
}
`.trim();
