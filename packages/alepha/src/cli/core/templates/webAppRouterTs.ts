export interface WebAppRouterOptions {
  api?: boolean;
  saas?: boolean;
}

export const webAppRouterTs = (options: WebAppRouterOptions) => {
  if (options.saas) {
    return saasAppRouterTs();
  }
  return basicAppRouterTs(options);
};

const basicAppRouterTs = (options: WebAppRouterOptions) => {
  const imports: string[] = ['import { $page } from "alepha/react/router";'];
  const classMembers: string[] = [];

  if (options.api) {
    imports.push('import { $client } from "alepha/server/links";');
    imports.push(
      'import type { HelloController } from "../api/controllers/HelloController.ts";',
    );
    classMembers.push("  api = $client<HelloController>();");

    classMembers.push(`  home = $page({
    path: "/",
    lazy: () => import("./components/Home.tsx"),
    loader: () => this.api.hello(),
  });`);
  } else {
    classMembers.push(`  home = $page({
    path: "/",
    lazy: () => import("./components/Home.tsx"),
  });`);
  }

  return `${imports.join("\n")}

export class AppRouter {
${classMembers.join("\n\n")}
}`;
};

/**
 * SaaS router wires three trees onto the app:
 *   /            → Home
 *   /auth/*      → AuthLayout + login / register / reset / verify
 *   /admin/*     → AdminLayout + users / sessions / api-keys / parameters / audits
 *
 * Each auth page resolves the realm config from its loader, so the registry
 * components render with everything they need on first paint.
 */
const saasAppRouterTs =
  () => `import type { RealmController } from "alepha/api/users";
import { $page, NotFound } from "alepha/react/router";
import { $secure } from "alepha/security";
import { $client } from "alepha/server/links";
import type { HelloController } from "../api/controllers/HelloController.ts";

export class AppRouter {
  protected readonly api = $client<HelloController>();
  protected readonly realmApi = $client<RealmController>();

  home = $page({
    path: "/",
    lazy: () => import("./components/Home.tsx"),
    loader: () => this.api.hello(),
  });

  // ── /auth — login, register, reset, verify ─────────────────────────────
  authLayout = $page({
    path: "/auth",
    lazy: () => import("./components/auth/AuthLayout.tsx"),
  });

  login = $page({
    parent: this.authLayout,
    path: "/login",
    name: "login",
    head: { title: "Sign in" },
    lazy: () => import("./components/auth/Login.tsx"),
    loader: async () => ({ realmConfig: await this.realmApi.getRealmConfig() }),
  });

  register = $page({
    parent: this.authLayout,
    path: "/register",
    name: "register",
    head: { title: "Sign up" },
    lazy: () => import("./components/auth/Register.tsx"),
    loader: async () => ({ realmConfig: await this.realmApi.getRealmConfig() }),
  });

  resetPassword = $page({
    parent: this.authLayout,
    path: "/reset-password",
    head: { title: "Reset password" },
    lazy: () => import("./components/auth/ResetPassword.tsx"),
    loader: async () => ({ realmConfig: await this.realmApi.getRealmConfig() }),
  });

  verifyEmail = $page({
    parent: this.authLayout,
    path: "/verify-email",
    head: { title: "Verify email" },
    lazy: () => import("./components/auth/VerifyEmail.tsx"),
  });

  // ── /admin — gated by 'admin:ui' permission, declared in RealmProvider.
  // Children inherit the gate via the parent chain.
  adminLayout = $page({
    path: "/admin",
    use: [$secure({ permissions: ["admin:ui"] })],
    lazy: () => import("./components/admin/AdminLayout.tsx"),
  });

  adminUsers = $page({
    parent: this.adminLayout,
    path: "/users",
    head: { title: "Users" },
    lazy: () => import("./components/admin/Users.tsx"),
  });

  adminSessions = $page({
    parent: this.adminLayout,
    path: "/sessions",
    head: { title: "Sessions" },
    lazy: () => import("./components/admin/Sessions.tsx"),
  });

  notFound = $page({ path: "/*", component: NotFound });
}
`;
