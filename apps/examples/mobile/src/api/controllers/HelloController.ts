import { $action } from "alepha/server";

import { helloResponseSchema } from "../schemas/helloResponseSchema.ts";

export class HelloController {
  hello = $action({
    path: "/hello",
    schema: {
      response: helloResponseSchema,
    },
    handler: () => ({
      appName: "Mobile",
      serverTime: new Date().toISOString(),
    }),
  });
}
