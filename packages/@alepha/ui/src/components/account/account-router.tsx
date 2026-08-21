import { $pageNav } from "@alepha/ui/components/nav-shell/nav-page";
import { $store } from "alepha";
import type { ApiKeyController } from "alepha/api/keys";
import type {
  MyConnectionController,
  MyIdentityController,
  MyProfileController,
  MySessionController,
  RealmController,
} from "alepha/api/users";
import { $page } from "alepha/react/router";
import { $secure } from "alepha/security";
import { $client } from "alepha/server/links";
import { KeyRound, Plug, RadioTower, ShieldCheck, User } from "lucide-react";
import { createElement } from "react";

import { accountRouterOptionsAtom } from "./account-router-options.tsx";

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
 * import { AccountRouter } from "@alepha/ui/components/account/account-router";
 *
 * export const MyWeb = $module({
 *   name: "my.web",
 *   services: [MyRouter, AuthRouter, AccountRouter],
 * });
 * ```
 *
 * ### Mount it standalone, or inside your own layout
 *
 * {@link AccountRouter.layout} is a root `$page`, so registering the service
 * puts `/account` at the root with only the `header` slot for chrome. An
 * application that wants it *inside* its own header and footer adds
 * `accountRouter.layout` to that layout's `children`:
 *
 * ```ts
 * layout = $page({
 *   children: () => [this.home, this.account.layout, this.notFound],
 *   lazy: () => import("./Layout.tsx"),
 * });
 * ```
 *
 * `ReactPageProvider` excludes an adopted page from the root set, so it
 * renders nested. This is why the options atom has no `parent` field: a
 * boot-time atom carrying a `PagePrimitive` would be order-fragile, and the
 * mechanism already exists.
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
 * `$pageAccount` is the one-call way to add a page. Take `order: 100` or
 * above, or declare your own `nav.group` — the built-ins occupy `Account`
 * (order 1) and `Security` (orders 2-5), and `useNavEntries` sorts groups by
 * their smallest member, so a page at a lower order silently reshuffles the
 * shared rail.
 */
export class AccountRouter {
  protected readonly options = $store(accountRouterOptionsAtom);

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
  layout = $page({
    name: "account",
    path: "/account",
    use: [$secure()],
    nav: { label: "Account" },
    lazy: () => import("./account-layout.tsx"),
  });

  profile = $pageNav({
    parent: this.layout,
    path: "/",
    name: "accountProfile",
    head: { title: "Profile" },
    can: () => this.profileApi.getMyProfile.can(),
    nav: {
      label: "Profile",
      icon: createElement(User),
      group: "Account",
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
    lazy: () => import("./account-profile.tsx"),
    props: () => this.options.pages?.profile ?? {},
  });

  security = $pageNav({
    parent: this.layout,
    path: "/security",
    name: "accountSecurity",
    head: { title: "Security" },
    can: () => this.identityApi.listMyIdentities.can(),
    nav: {
      label: "Security",
      icon: createElement(ShieldCheck),
      group: "Security",
      order: 2,
      keywords: ["password", "identities", "sign-in", "delete account"],
    },
    loader: async () => ({
      identities: await this.identityApi.listMyIdentities(),
    }),
    lazy: () => import("./account-security.tsx"),
    props: () => this.options.pages?.security ?? {},
  });

  sessions = $pageNav({
    parent: this.layout,
    path: "/sessions",
    name: "accountSessions",
    head: { title: "Sessions" },
    can: () => this.sessionApi.listMySessions.can(),
    nav: {
      label: "Sessions",
      icon: createElement(RadioTower),
      group: "Security",
      order: 3,
      keywords: ["devices", "sign out"],
    },
    loader: async () => ({ sessions: await this.sessionApi.listMySessions() }),
    lazy: () => import("./account-sessions.tsx"),
    props: () => this.options.pages?.sessions ?? {},
  });

  keys = $pageNav({
    parent: this.layout,
    path: "/keys",
    name: "accountKeys",
    head: { title: "API keys" },
    can: () => this.apiKeyApi.listApiKeys.can(),
    nav: {
      label: "API keys",
      icon: createElement(KeyRound),
      group: "Security",
      order: 4,
      keywords: ["tokens", "credentials"],
    },
    loader: async () => ({ apiKeys: await this.apiKeyApi.listApiKeys() }),
    lazy: () => import("./account-keys.tsx"),
    props: () => this.options.pages?.keys ?? {},
  });

  connections = $pageNav({
    parent: this.layout,
    path: "/connections",
    name: "accountConnections",
    head: { title: "Connected apps" },
    can: () => this.connectionApi.listMyConnections.can(),
    nav: {
      label: "Connected apps",
      icon: createElement(Plug),
      group: "Security",
      order: 5,
      keywords: ["oauth", "mcp", "integrations"],
    },
    loader: async () => ({
      connections: await this.connectionApi.listMyConnections(),
    }),
    lazy: () => import("./account-connections.tsx"),
    props: () => this.options.pages?.connections ?? {},
  });
}
