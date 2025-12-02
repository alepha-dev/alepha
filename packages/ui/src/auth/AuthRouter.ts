import { $page } from "@alepha/react";
import { ReactAuth } from "@alepha/react/auth";
import {
  IconLogin2,
  IconLogout2,
  IconPasswordUser,
  IconUserPlus,
} from "@tabler/icons-react";
import { $inject, t } from "alepha";
import type { UserRealmController } from "alepha/api/users";
import { $client } from "alepha/server/links";

export class AuthRouter {
  protected readonly userRealmClient = $client<UserRealmController>();
  protected readonly auth = $inject(ReactAuth);

  layout = $page({
    name: "AuthLayout",
    path: "/auth",
    lazy: () => import("./components/AuthLayout.tsx"),
    children: () => [this.login, this.register, this.resetPassword],
  });

  login = $page({
    icon: IconLogin2,
    label: "Sign In",
    description: "Sign in to your account",
    path: "/login",
    schema: {
      query: t.object({
        r: t.optional(t.string()),
      }),
    },
    can: () => !this.auth.user,
    lazy: () => import("./components/Login.tsx"),
    resolve: async () => {
      return {
        realmConfig: await this.userRealmClient.getRealmConfig(),
      };
    },
  });

  register = $page({
    icon: IconUserPlus,
    label: "Register",
    description: "Create a new account",
    path: "/register",
    schema: {
      query: t.object({
        r: t.optional(t.string()),
      }),
    },
    can: () => !this.auth.user,
    lazy: () => import("./components/Register.tsx"),
    resolve: async () => {
      return {
        realmConfig: await this.userRealmClient.getRealmConfig(),
      };
    },
  });

  resetPassword = $page({
    icon: IconPasswordUser,
    label: "Reset Password",
    description: "Reset your account password",
    path: "/reset-password",
    schema: {
      query: t.object({
        r: t.optional(t.string()),
      }),
    },
    can: () => !this.auth.user,
    lazy: () => import("./components/ResetPassword.tsx"),
    resolve: async () => {
      return {
        realmConfig: await this.userRealmClient.getRealmConfig(),
      };
    },
  });

  logout = $page({
    icon: IconLogout2,
    label: "Sign Out",
    description: "Sign out of your account",
    can: () => !!this.auth.user,
    path: "/logout",
    component: () => null,
    resolve: () => {
      this.auth.logout();
      return {};
    },
  });
}
