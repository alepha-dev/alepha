import { $page } from "@alepha/react";
import { t } from "alepha";
import type { UserRealmController } from "alepha/api/users";
import { $client } from "alepha/server/links";

export class AuthRouter {
  userRealmClient = $client<UserRealmController>();

  login = $page({
    path: "/login",
    schema: {
      query: t.object({
        redirect: t.optional(t.string()),
      }),
    },
    lazy: () => import("./components/Login.tsx"),
    resolve: async () => {
      return {
        realmConfig: await this.userRealmClient.getRealmConfig(),
      };
    },
  });

  register = $page({
    path: "/register",
    schema: {
      query: t.object({
        redirect: t.optional(t.string()),
      }),
    },
    lazy: () => import("./components/Register.tsx"),
    resolve: async () => {
      return {
        realmConfig: await this.userRealmClient.getRealmConfig(),
      };
    },
  });

  resetPassword = $page({
    path: "/reset-password",
    schema: {
      query: t.object({
        redirect: t.optional(t.string()),
      }),
    },
    lazy: () => import("./components/ResetPassword.tsx"),
    resolve: async () => {
      return {
        realmConfig: await this.userRealmClient.getRealmConfig(),
      };
    },
  });
}
