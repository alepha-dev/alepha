import { $context } from "@alepha/core";
import { $auth } from "@alepha/react-auth";
import type { RealmDescriptor } from "@alepha/security";
import { SessionService } from "../services/SessionService.ts";

export const $authCredentials = (realm: RealmDescriptor) => {
  const { alepha } = $context();
  const sessionService = alepha.inject(SessionService);

  return $auth({
    realm,
    name: "credentials",
    credentials: {
      account: async (it) => {
        return await sessionService.login(
          "credentials",
          it.username, // username can act as email or username
          it.password,
        );
      },
    },
  });
};
