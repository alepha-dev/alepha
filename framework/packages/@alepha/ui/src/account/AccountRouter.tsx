import { $inject, $store } from "alepha";
import type { ApiKeyController } from "alepha/api/keys";
import type {
  MyConnectionController,
  MyIdentityController,
  MyProfileController,
  MySessionController,
  RealmController,
} from "alepha/api/users";
import { I18nProvider } from "alepha/react/i18n";
import { $secure } from "alepha/security";
import { $client } from "alepha/server/links";
import { KeyRound, Plug, RadioTower, ShieldCheck, User } from "lucide-react";
import { createElement } from "react";

import { $pageNav } from "../shell/$pageNav.tsx";
import {
  type AccountPageName,
  accountRouterOptionsAtom,
} from "./AccountRouterOptions.tsx";

/**
 * The whole `/account` surface — five pages and their shell — mounted and
 * wired. The user-facing counterpart of `AdminRouter`.
 *
 * ⚠️ **Nav icons are `createElement(Icon)`, never `<Icon />`.** Same reason as
 * `AdminRouter`: this module is evaluated *eagerly* in the server graph, and
 * `alepha db migrations create` imports that graph under `tsx`, which applies
 * a tsconfig resolved from the app root. A file outside that tsconfig's
 * `include` — which this one is, living in a sibling workspace — gets
 * esbuild's defaults, whose JSX transform is the *classic* one. The emitted
 * `React.createElement` then fails with `ReferenceError: React is not
 * defined`, breaking migration generation for the whole app.
 *
 * ```ts
 * import { AccountRouter } from "@alepha/ui/account";
 *
 * export const MyWeb = $module({
 *   name: "my.web",
 *   services: [MyRouter, AuthRouter, AccountRouter],
 * });
 * ```
 *
 * ### A root shell, like `/admin`
 *
 * {@link AccountRouter.layout} is a root `$page`: registering the service
 * puts `/account` at the root of the application, drawn by `AccountLayout`,
 * a full-viewport `NavShell` with a floating sidebar, its own topbar and a
 * way back to the site. It is **not** adopted into the application's own
 * layout any more. Its `AppShell` mounts `DialogProvider`, `Toaster` and
 * `ActionErrorToaster` itself, so an application that still put
 * `this.account.layout` among its layout's `children`, under a layout with
 * its own `Toaster`, would show every toast twice.
 *
 * The chrome is configured on `accountRouterOptionsAtom` (`brand`,
 * `topbarActions`, `homeRouteName`, `loginRouteName`, `colorScheme`,
 * `extraNav`), mirroring `adminRouterOptionsAtom`:
 *
 * ```ts
 * alepha.set(accountRouterOptionsAtom, {
 *   brand: <MyBrand />,
 *   homeRouteName: "home",
 * });
 * ```
 *
 * A page frames itself with `AccountPage`: `variant="table"` for a
 * `DataTable` filling the area, `variant="form"` for a centred column of
 * cards.
 *
 * ### Every page is mounted; none is conditionally registered
 *
 * A page whose backing module is not registered hides itself through `can`,
 * which resolves an action name against `/api/_links` — a registry built from
 * the actions the server actually registered. `permission` could not do this:
 * `$secure` registers a permission at definition time whether or not any
 * controller backs it, so an admin holding `*` would be granted it over a
 * dead API. The API-keys page is the clearest case — it disappears entirely
 * for an application that never mounts `AlephaApiKeys`.
 *
 * (Connections is *not* an example of that any more. `MyConnectionController`
 * had to move from `api/oauth` into `api/users` to break a circular module
 * dependency, so its action exists wherever `api/users` does — see that
 * controller's own JSDoc.)
 *
 * There is deliberately no `pages: [...]` allowlist: a second gate on top of
 * one that already works goes stale.
 *
 * ### These five route names are prefixed on purpose
 *
 * `AdminRouter` already claims `sessions` and `keys` globally, and
 * `ReactPageProvider.page()` returns the *first* match on a duplicate — so
 * bare names here would shadow the admin ones, or be shadowed by them,
 * silently, depending on mount order. `accountProfile`, `accountSecurity`,
 * `accountSessions`, `accountKeys` and `accountConnections` each carry an
 * explicit `name:` so renaming a field later never changes the public route
 * name.
 *
 * ### Extending the shell
 *
 * `$pageAccount` is the one-call way to add a page.
 *
 * ### Group order is a contract
 *
 * Three bands, personal first, then the application, then security:
 *
 * - `Account` (Profile) at order 1;
 * - the application's own groups at 100-999;
 * - `Security` (Security, Sessions, API keys, Connected apps) parked at
 *   1000-1003.
 *
 * `useNavEntries` sorts groups by their smallest member, so a page at
 * `order: 100` with its own `nav.group` sorts between the two built-in
 * groups without asking, and only an order of 1000 or more sinks it in among
 * the security pages.
 *
 * ### Tab titles
 *
 * Every built-in page's head is {@link AccountRouter.accountHead}:
 * `Account - <Page>` in the reader's language, the way `adminHead` titles
 * the admin console.
 */
export class AccountRouter {
  protected readonly options = $store(accountRouterOptionsAtom);
  protected readonly i18n = $inject(I18nProvider);

  /**
   * The head of an account page: `Account - <Page>` in the browser tab.
   *
   * A function, evaluated when the page renders, so the tab follows the
   * reader's language: `key` names the page's title in the catalogue (the
   * built-ins pass their nav `labelKey`), `title` is the English fallback,
   * and the prefix is `account.title`. The layout cannot add the prefix
   * itself, for the reason `AdminRouter.adminHead` gives: `HeadProvider`
   * would join the two as "Profile - Account".
   */
  public accountHead(title: string, key?: string): () => { title: string } {
    return () => ({
      title: this.accountTitle(
        key ? this.i18n.tr(key, { default: title }) : title,
      ),
    });
  }

  /**
   * `Account - <title>`, the prefix in the reader's language
   * (`account.title`). The title itself is used as given.
   */
  public accountTitle(title: string): string {
    return this.i18n.tr("account.title", {
      default: "Account - $1",
      args: [title],
    });
  }

  /**
   * Whether the application has declared it does not offer this page.
   *
   * ANDed into each page's `can`, never replacing it: whether the action
   * exists stays the registry's question. See
   * `AccountRouterOptions.hide` for the page this exists for and why `can`
   * alone cannot answer it.
   */
  protected hidden(page: AccountPageName): boolean {
    return this.options.hide?.includes(page) ?? false;
  }

  protected readonly profileApi = $client<MyProfileController>();
  protected readonly realmApi = $client<RealmController>();
  protected readonly identityApi = $client<MyIdentityController>();
  protected readonly sessionApi = $client<MySessionController>();
  protected readonly apiKeyApi = $client<ApiKeyController>();
  protected readonly connectionApi = $client<MyConnectionController>();

  /**
   * Anchors the shell. Not itself a nav entry — a shell root is excluded from
   * its own rail.
   *
   * `$secure()` with no permission means signed-in only, which is both the
   * right gate (nothing here means anything to an anonymous visitor) and what
   * puts the subtree in CSR.
   *
   * No index redirect: {@link profile} sits at `path: "/"`, so a bare
   * `/account` resolves to it directly. `AdminRouter` now anchors its
   * dashboard the same way.
   */
  layout = $pageNav({
    name: "account",
    path: "/account",
    use: [$secure()],
    nav: { label: "Account", labelKey: "account.nav.account" },
    lazy: () => import("./AccountLayout.tsx"),
  });

  profile = $pageNav({
    parent: this.layout,
    path: "/",
    name: "accountProfile",
    head: this.accountHead("Profile", "account.nav.profile"),
    can: () => !this.hidden("profile") && this.profileApi.getMyProfile.can(),
    nav: {
      label: "Profile",
      labelKey: "account.nav.profile",
      icon: createElement(User),
      group: "Account",
      groupKey: "account.nav.group.account",
      order: 1,
    },
    /*
     * `realmConfig` rides along because the page has one realm-dependent
     * field: a realm with `username: "none"` or `"email"` has no handle to
     * edit. It is the same call `AuthRouter.loadRealm` makes for the same
     * reason, and the same public endpoint — cheap, and already warm from
     * sign-in.
     *
     * Both are fetched together rather than in sequence: they do not depend
     * on each other, and the account area is behind `$secure`, so this runs
     * client-side where a waterfall is two round trips instead of one.
     */
    loader: async () => {
      const [profile, realmConfig] = await Promise.all([
        this.profileApi.getMyProfile(),
        this.realmApi.getRealmConfig(),
      ]);
      return { profile, realmConfig };
    },
    lazy: () => import("./AccountProfile.tsx"),
    props: () => this.options.pages?.profile ?? {},
  });

  security = $pageNav({
    parent: this.layout,
    path: "/security",
    name: "accountSecurity",
    head: this.accountHead("Security", "account.nav.security"),
    can: () =>
      !this.hidden("security") && this.identityApi.listMyIdentities.can(),
    nav: {
      label: "Security",
      labelKey: "account.nav.security",
      icon: createElement(ShieldCheck),
      group: "Security",
      groupKey: "account.nav.group.security",
      order: 1000,
      keywords: ["password", "identities", "sign-in", "delete account"],
    },
    /*
     * `realmConfig` rides along for the same reason it does on {@link profile}:
     * one row here is realm-dependent. A realm with `mfa.totp: "disabled"` must
     * not be offered the two-factor row, or the user enrolls into a factor the
     * login gate will never ask for.
     */
    loader: async () => {
      const [identities, realmConfig] = await Promise.all([
        this.identityApi.listMyIdentities(),
        this.realmApi.getRealmConfig(),
      ]);
      return { identities, realmConfig };
    },
    lazy: () => import("./AccountSecurity.tsx"),
    props: () => this.options.pages?.security ?? {},
  });

  sessions = $pageNav({
    parent: this.layout,
    path: "/sessions",
    name: "accountSessions",
    head: this.accountHead("Sessions", "account.nav.sessions"),
    can: () => !this.hidden("sessions") && this.sessionApi.listMySessions.can(),
    nav: {
      label: "Sessions",
      labelKey: "account.nav.sessions",
      icon: createElement(RadioTower),
      group: "Security",
      groupKey: "account.nav.group.security",
      order: 1001,
      keywords: ["devices", "sign out"],
    },
    loader: async () => ({ sessions: await this.sessionApi.listMySessions() }),
    lazy: () => import("./AccountSessions.tsx"),
    props: () => this.options.pages?.sessions ?? {},
  });

  keys = $pageNav({
    parent: this.layout,
    path: "/keys",
    name: "accountKeys",
    head: this.accountHead("API keys", "account.nav.keys"),
    can: () => !this.hidden("keys") && this.apiKeyApi.listApiKeys.can(),
    nav: {
      label: "API keys",
      labelKey: "account.nav.keys",
      icon: createElement(KeyRound),
      group: "Security",
      groupKey: "account.nav.group.security",
      order: 1002,
      keywords: ["tokens", "credentials"],
    },
    loader: async () => ({ apiKeys: await this.apiKeyApi.listApiKeys() }),
    lazy: () => import("./AccountKeys.tsx"),
    props: () => this.options.pages?.keys ?? {},
  });

  connections = $pageNav({
    parent: this.layout,
    path: "/connections",
    name: "accountConnections",
    head: this.accountHead("Connected apps", "account.nav.connections"),
    can: () =>
      !this.hidden("connections") && this.connectionApi.listMyConnections.can(),
    nav: {
      label: "Connected apps",
      labelKey: "account.nav.connections",
      icon: createElement(Plug),
      group: "Security",
      groupKey: "account.nav.group.security",
      order: 1003,
      keywords: ["oauth", "mcp", "integrations"],
    },
    loader: async () => ({
      connections: await this.connectionApi.listMyConnections(),
    }),
    lazy: () => import("./AccountConnections.tsx"),
    props: () => this.options.pages?.connections ?? {},
  });
}
