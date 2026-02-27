import { t } from "alepha";
import { $action } from "alepha/server";

export class AppSecurity {
  ping = $action({
    schema: {
      body: t.object({
        ping: t.string(),
      }),
      response: t.object({
        message: t.string(),
      }),
    },
    handler: () => {
      return {
        message: "pong",
      };
    },
  });
}
