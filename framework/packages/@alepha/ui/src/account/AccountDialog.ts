import { $store } from "alepha";
import type { ApiKeyController } from "alepha/api/keys";
import type {
  MyConnectionController,
  MyIdentityController,
  MyProfileController,
  MySessionController,
} from "alepha/api/users";
import { $client } from "alepha/server/links";
import { KeyRound, Plug, RadioTower, ShieldCheck, User } from "lucide-react";
import { createElement } from "react";

import { $settingsDialog } from "../settings/$settingsDialog.ts";
import { $settingsSection } from "../settings/$settingsSection.ts";
import {
  type AccountSectionName,
  accountDialogOptionsAtom,
} from "./AccountDialogOptions.ts";

/**
 * The signed-in user's account, as a settings dialog over the current page:
 * Profile, Security, Sessions, API keys and Connected apps. Opened with
 * `useSettingsDialog("account").open()`, from the account item of the user
 * menu, or by a link carrying `?account=<section>` (`/?account=sessions`).
 *
 * ```ts
 * import { AccountDialog } from "@alepha/ui/account";
 *
 * export const MyWeb = $module({
 *   name: "my.web",
 *   services: [MyRouter, AuthRouter, AccountDialog],
 * });
 * ```
 *
 * No route is registered. `DialogProvider` draws the dialog, so any shell
 * with one (`AppShell`, the admin shell, a hand-built layout) shows it. Each
 * section fetches its own data when it is shown.
 *
 * ### Adding a section
 *
 * There is no wrapper: declare one with `$settingsSection` against
 * {@link AccountDialog.dialog}, from any class.
 *
 * ```ts
 * class Billing {
 *   protected readonly account = $inject(AccountDialog);
 *   protected readonly invoiceApi = $client<InvoiceController>();
 *
 *   invoices = $settingsSection({
 *     dialog: this.account.dialog,
 *     name: "invoices",
 *     label: "Invoices",
 *     // ⚠️ `createElement(Icon)`, never `<Icon />`: this class is
 *     // evaluated in the server graph, which `alepha db migrations create`
 *     // imports under `tsx` with the classic JSX transform.
 *     icon: createElement(Receipt),
 *     group: "Billing",
 *     order: 100,
 *     can: () => this.invoiceApi.listMyInvoices.can(),
 *     lazy: () => import("./MyInvoices.tsx"),
 *   });
 * }
 * ```
 *
 * ### Every section is declared; none is conditionally registered
 *
 * A section whose backing module is not registered hides itself through
 * `can`, which resolves an action name against `/api/_links`, a registry
 * built from the actions the server actually registered: the API-keys
 * section disappears for an application that never mounts `AlephaApiKeys`.
 * An application hides one whose action is always there with
 * `accountDialogOptionsAtom`'s `hide`.
 *
 * ### Group order is a contract
 *
 * Three bands, personal first, then the application, then security:
 *
 * - `Account` (Profile) at order 1;
 * - the application's own groups at 100-999;
 * - `Security` (Security, Sessions, API keys, Connected apps) at 1000-1003.
 *
 * Groups sort by their smallest member, so a section at `order: 100` in its
 * own group sits between the two built-in ones.
 *
 * ⚠️ **Icons are `createElement(Icon)`, never `<Icon />`.** This module is
 * evaluated eagerly in the server graph, and `alepha db migrations create`
 * imports that graph under `tsx` with esbuild's classic JSX transform, whose
 * `React.createElement` fails with `React is not defined`.
 */
export class AccountDialog {
  protected readonly options = $store(accountDialogOptionsAtom);

  protected readonly profileApi = $client<MyProfileController>();
  protected readonly identityApi = $client<MyIdentityController>();
  protected readonly sessionApi = $client<MySessionController>();
  protected readonly apiKeyApi = $client<ApiKeyController>();
  protected readonly connectionApi = $client<MyConnectionController>();

  /**
   * Whether the application has declared it does not offer this section.
   * ANDed into each section's `can`, never replacing it.
   */
  protected hidden(section: AccountSectionName): boolean {
    return this.options.hide?.includes(section) ?? false;
  }

  /**
   * The account dialog, named `account`: what `useSettingsDialog("account")`
   * takes, and the query parameter that opens it from a link.
   */
  public readonly dialog = $settingsDialog({
    name: "account",
    title: "Account",
    titleKey: "account.dialog.title",
  });

  profile = $settingsSection({
    dialog: this.dialog,
    name: "profile",
    label: "Profile",
    labelKey: "account.nav.profile",
    icon: createElement(User),
    group: "Account",
    groupKey: "account.nav.group.account",
    order: 1,
    can: () => !this.hidden("profile") && this.profileApi.getMyProfile.can(),
    lazy: () => import("./AccountProfile.tsx"),
    props: () => this.options.pages?.profile ?? {},
  });

  security = $settingsSection({
    dialog: this.dialog,
    name: "security",
    label: "Security",
    labelKey: "account.nav.security",
    icon: createElement(ShieldCheck),
    group: "Security",
    groupKey: "account.nav.group.security",
    order: 1000,
    can: () =>
      !this.hidden("security") && this.identityApi.listMyIdentities.can(),
    lazy: () => import("./AccountSecurity.tsx"),
    props: () => this.options.pages?.security ?? {},
  });

  sessions = $settingsSection({
    dialog: this.dialog,
    name: "sessions",
    label: "Sessions",
    labelKey: "account.nav.sessions",
    icon: createElement(RadioTower),
    group: "Security",
    groupKey: "account.nav.group.security",
    order: 1001,
    can: () => !this.hidden("sessions") && this.sessionApi.listMySessions.can(),
    lazy: () => import("./AccountSessions.tsx"),
    props: () => this.options.pages?.sessions ?? {},
  });

  keys = $settingsSection({
    dialog: this.dialog,
    name: "keys",
    label: "API keys",
    labelKey: "account.nav.keys",
    icon: createElement(KeyRound),
    group: "Security",
    groupKey: "account.nav.group.security",
    order: 1002,
    can: () => !this.hidden("keys") && this.apiKeyApi.listApiKeys.can(),
    lazy: () => import("./AccountKeys.tsx"),
    props: () => this.options.pages?.keys ?? {},
  });

  connections = $settingsSection({
    dialog: this.dialog,
    name: "connections",
    label: "Connected apps",
    labelKey: "account.nav.connections",
    icon: createElement(Plug),
    group: "Security",
    groupKey: "account.nav.group.security",
    order: 1003,
    can: () =>
      !this.hidden("connections") && this.connectionApi.listMyConnections.can(),
    lazy: () => import("./AccountConnections.tsx"),
    props: () => this.options.pages?.connections ?? {},
  });
}
