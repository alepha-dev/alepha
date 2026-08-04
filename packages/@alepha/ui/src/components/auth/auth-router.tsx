import type { RealmController } from "alepha/api/users";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";
import { AuthLogin } from "./auth-login.tsx";
import { AuthRegister } from "./auth-register.tsx";
import { AuthResetPassword } from "./auth-reset-password.tsx";
import { AuthVerifyEmail } from "./auth-verify-email.tsx";

/**
 * The four authentication screens, mounted and wired — a router you can use
 * as-is.
 *
 * ```ts
 * import { AuthRouter } from "@alepha/ui/components/auth/auth-router";
 *
 * export const MyWeb = $module({
 *   name: "my.web",
 *   services: [MyRouter, AuthRouter],
 * });
 * ```
 *
 * That is the whole integration: `/auth/login`, `/auth/register`,
 * `/auth/reset-password` and `/auth/verify-email` exist, each loads the realm
 * configuration, and the links between them point at each other.
 *
 * ### Why this exists
 *
 * `@alepha/mantine/auth/AuthRouter` used to do exactly this, and was deleted with
 * Mantine without being ported. What survived were the components — the bricks
 * without the thing that assembled them — so every application rebuilt the same
 * four pages by hand: `apps/lore` in 414 lines across two files, `apps/shop` in
 * three more. `apps/shop` has since been moved onto this router and deleted its
 * three; `apps/lore` still has its own.
 *
 * Worse, the components kept the old router's paths as their fallbacks
 * (`props.loginPath ?? "/auth/login"`). Those defaults described a topology
 * nothing mounted any more, so an application that placed its pages elsewhere
 * inherited internal links pointing at nothing — a 404 you only find by clicking,
 * invisible to typecheck, to tests, and to an e2e suite that reaches the sign-in
 * page by URL. Mounting this router makes those defaults true again.
 *
 * ### Optional, and replaceable
 *
 * Nothing imports it implicitly. An application that wants different URLs — say
 * `/compte/connexion` for a French storefront — writes its own router and passes
 * the components' path props itself; that stays entirely supported, and this
 * class is a readable reference for what wiring it by hand involves. It is a real
 * trade rather than a free one: `apps/shop` made exactly that choice, then gave
 * it up for this router, because the French URLs also cost it a bespoke auth
 * layout, four hand-kept cross-links and the `verify-email` page it never got
 * round to writing.
 *
 * The paths here are fixed on purpose. Making them configurable would mean
 * threading a configuration object through four pages to save an application that
 * wants its own URLs about twenty lines — and that application also wants its own
 * titles, its own layout and its own copy. The seam is "use this router, or write
 * one", not "use this router with a hundred options".
 */
export class AuthRouter {
  protected readonly realmApi = $client<RealmController>();

  /**
   * Shared by all four pages: every screen needs to know what the realm allows
   * before it can decide what to render.
   */
  protected loadRealm = async () => ({
    realmConfig: await this.realmApi.getRealmConfig(),
  });

  /**
   * Named `login` rather than `authLogin`, because that is the name other parts
   * of the framework look for — `$secure`'s redirect and `ButtonUser`'s sign-in
   * action both push a route called `login`.
   */
  login = $page({
    path: "/auth/login",
    name: "login",
    head: { title: "Sign in" },
    loader: () => this.loadRealm(),
    component: (props: { realmConfig: any }) => (
      <AuthLogin
        realmConfig={props.realmConfig}
        registerPath="/auth/register"
        resetPasswordPath="/auth/reset-password"
      />
    ),
  });

  register = $page({
    path: "/auth/register",
    name: "register",
    head: { title: "Create an account" },
    loader: () => this.loadRealm(),
    component: (props: { realmConfig: any }) => (
      <AuthRegister
        realmConfig={props.realmConfig}
        loginPath="/auth/login"
        cancelPath="/"
      />
    ),
  });

  resetPassword = $page({
    path: "/auth/reset-password",
    name: "resetPassword",
    head: { title: "Reset your password" },
    loader: () => this.loadRealm(),
    component: (props: { realmConfig: any }) => (
      <AuthResetPassword
        realmConfig={props.realmConfig}
        loginPath="/auth/login"
      />
    ),
  });

  /**
   * Reached from a link in an email, so it takes its `email` and `token` from the
   * query string rather than from any state the browser already holds.
   */
  verifyEmail = $page({
    path: "/auth/verify-email",
    name: "verifyEmail",
    head: { title: "Verify your email" },
    component: () => <AuthVerifyEmail loginPath="/auth/login" />,
  });
}
