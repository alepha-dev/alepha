import { t } from "alepha";
import { $action } from "alepha/server";

export class AppSecurity {
  // realm = $userRealm({
  //   identities: {
  //     google: true,
  //     credentials: true,
  //     github: true,
  //   },
  //   settings: {
  //     resetPasswordAllowed: true,
  //     verifyEmailRequired: true,
  //   },
  // });

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
