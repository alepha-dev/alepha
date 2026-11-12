import { $settingsDialog, $settingsSection } from "@alepha/ui/settings";
import { CreditCard, Monitor, ShieldAlert, User } from "lucide-react";
import { createElement } from "react";

/**
 * The settings dialog the Settings block opens: a `$settingsDialog` and its
 * sections, declared the way an application declares its own. Each section is
 * a lazy component built from the settings content blocks.
 *
 * Icons are `createElement(Icon)` for the reason every router here gives: the
 * class is evaluated in the server graph.
 */
export class ShowcaseSettings {
  public readonly dialog = $settingsDialog({
    name: "workspace",
    title: "Workspace settings",
  });

  profile = $settingsSection({
    dialog: this.dialog,
    name: "profile",
    label: "Profile",
    icon: createElement(User),
    group: "Account",
    order: 1,
    lazy: () => import("./pages/blocks/settings/SettingsProfile.tsx"),
  });

  sessions = $settingsSection({
    dialog: this.dialog,
    name: "sessions",
    label: "Sessions",
    icon: createElement(Monitor),
    group: "Account",
    order: 2,
    lazy: () => import("./pages/blocks/settings/SettingsSessions.tsx"),
  });

  billing = $settingsSection({
    dialog: this.dialog,
    name: "billing",
    label: "Billing",
    icon: createElement(CreditCard),
    group: "Workspace",
    order: 100,
    lazy: () => import("./pages/blocks/settings/SettingsBilling.tsx"),
  });

  danger = $settingsSection({
    dialog: this.dialog,
    name: "danger",
    label: "Danger zone",
    icon: createElement(ShieldAlert),
    group: "Workspace",
    order: 101,
    lazy: () => import("./pages/blocks/settings/SettingsDanger.tsx"),
  });
}
