import { ReactAuth } from "@alepha/react/auth";
import { $page } from "@alepha/react/router";
import {
  IconLogin2,
  IconLogout2,
  IconMailCheck,
  IconPasswordUser,
  IconUserPlus,
} from "@tabler/icons-react";
import { $inject, AlephaError, t } from "alepha";
import type { UserRealmController } from "alepha/api/users";
import { $client } from "alepha/server/links";

/**
 * Schema for realm query parameter used across auth pages.
 */
const realmQuerySchema = t.object({
  r: t.optional(t.string({ description: "Redirect URL after authentication" })),
  realm: t.optional(
    t.string({ description: "User realm name for multi-tenant auth" }),
  ),
});

export class AuthRouter {
  protected readonly userRealmClient = $client<UserRealmController>();
  protected readonly auth = $inject(ReactAuth);

  layout = $page({
    name: "AuthLayout",
    path: "/auth",
    lazy: () => import("./components/AuthLayout.tsx"),
    children: () => [
      this.login,
      this.register,
      this.resetPassword,
      this.verifyEmail,
    ],
  });

  login = $page({
    icon: IconLogin2,
    label: "Sign In",
    description: "Sign in to your account",
    path: "/login",
    schema: {
      query: realmQuerySchema,
    },
    can: () => !this.auth.user,
    lazy: () => import("./components/Login.tsx"),
    resolve: async ({ query }) => {
      return {
        realmConfig: await this.loadRealmConfig(query.realm),
      };
    },
  });

  register = $page({
    icon: IconUserPlus,
    label: "Register",
    description: "Create a new account",
    path: "/register",
    schema: {
      query: realmQuerySchema,
    },
    can: () => !this.auth.user,
    lazy: () => import("./components/Register.tsx"),
    resolve: async ({ query }) => {
      return {
        realmConfig: await this.loadRealmConfig(query.realm),
      };
    },
  });

  resetPassword = $page({
    icon: IconPasswordUser,
    label: "Reset Password",
    description: "Reset your account password",
    path: "/reset-password",
    schema: {
      query: realmQuerySchema,
    },
    can: () => !this.auth.user,
    lazy: () => import("./components/ResetPassword.tsx"),
    resolve: async ({ query }) => {
      return {
        realmConfig: await this.loadRealmConfig(query.realm),
      };
    },
  });

  verifyEmail = $page({
    icon: IconMailCheck,
    label: "Verify Email",
    description: "Verify your email address",
    path: "/verify-email",
    schema: {
      query: t.object({
        email: t.optional(t.string()),
        token: t.optional(t.string()),
      }),
    },
    lazy: () => import("./components/VerifyEmail.tsx"),
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

  protected async loadRealmConfig(userRealmName?: string) {
    try {
      return await this.userRealmClient.getRealmConfig({
        query: { userRealmName },
      });
    } catch (e) {
      if (e instanceof AlephaError) {
        throw new AlephaError(
          "Missing User-Realm Configuration - Did you forget to add '$userRealm()' to your application?",
          e,
        );
      }
      throw e;
    }
  }
}
