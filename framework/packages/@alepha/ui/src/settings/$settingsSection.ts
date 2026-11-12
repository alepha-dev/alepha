import { $context } from "alepha";

import {
  type SettingsSectionOptions,
  SettingsDialogs,
  SettingsSectionPrimitive,
} from "./SettingsDialogs.ts";

/**
 * Add a section to a settings dialog, from any class: the dialog is named by
 * the value `$settingsDialog` returned, the way `$pageNav` takes a `parent`.
 *
 * A section is not a page. No route is registered and there is no `loader`:
 * the component fetches its own data with `useQuery` when it is shown.
 *
 * - `group` and `order` place it in the nav: sections sort by `order` inside
 *   their group, and groups by their smallest member.
 * - `can` hides it, from the nav and from `open` alike.
 *
 * ```ts
 * class Billing {
 *   protected readonly account = $inject(AccountSettings);
 *   protected readonly api = $client<InvoiceController>();
 *
 *   invoices = $settingsSection({
 *     dialog: this.account.dialog,
 *     name: "invoices",
 *     label: "Invoices",
 *     group: "Billing",
 *     order: 100,
 *     can: () => this.api.listMyInvoices.can(),
 *     lazy: () => import("./MyInvoices.tsx"),
 *   });
 * }
 * ```
 */
export const $settingsSection = (
  options: SettingsSectionOptions,
): SettingsSectionPrimitive => {
  const { alepha } = $context();
  const section = new SettingsSectionPrimitive(options);
  alepha.inject(SettingsDialogs).registerSection(section);
  return section;
};
