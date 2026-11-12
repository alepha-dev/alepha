import { AccountDialog } from "@alepha/ui/account";
import { $settingsSection } from "@alepha/ui/settings";
import { $inject } from "alepha";
import { $client } from "alepha/server/links";
import { Bell, FolderKanban, Mail } from "lucide-react";
import { createElement } from "react";

import type { InvitationController } from "../../../../api/controllers/InvitationController.ts";
import type { NotificationPreferenceController } from "../../../../api/controllers/NotificationPreferenceController.ts";

/**
 * Lore's own sections of the account dialog (#E140).
 *
 * The five built-in sections (Profile, Security, Sessions, API keys,
 * Connected apps) arrive with `AccountDialog`; what Lore adds is what the
 * framework knows nothing about. Each fetches its own data when shown: there
 * is no loader, so Projects and Invitations fill `userProjectsAtom` themselves
 * (`useUserProjects`), once, as the old route loader did.
 *
 * ⚠️ **Icons are `createElement(Icon)`, never `<Icon />`**: this class is
 * evaluated eagerly in the server graph, which `alepha db migrations create`
 * imports under `tsx`, where the classic JSX transform emits a bare
 * `React.createElement`.
 *
 * Every section takes an order in 100-999 in its own `Lore` group: the
 * built-ins occupy `Account` (1) and `Security` (1000-1003), and groups sort
 * by their smallest member, so the Lore group sits between the two. Projects
 * leads it at exactly 100; Work's Feedback is 102.
 */
export class LoreAccountSections {
  protected readonly account = $inject(AccountDialog);
  protected readonly invitationApi = $client<InvitationController>();
  protected readonly notificationApi =
    $client<NotificationPreferenceController>();

  /**
   * The complete project list, behind Home's and the switcher's five.
   *
   * No `can()`: every signed-in user has projects to list, even if the list
   * is empty, unlike the sections below whose endpoints are permission-gated.
   */
  projects = $settingsSection({
    dialog: this.account.dialog,
    name: "projects",
    label: "Projects",
    labelKey: "account.nav.projects",
    icon: createElement(FolderKanban),
    group: "Lore",
    groupKey: "account.nav.group.lore",
    order: 100,
    lazy: () => import("./MyProjects.tsx"),
  });

  invitations = $settingsSection({
    dialog: this.account.dialog,
    name: "invitations",
    label: "Invitations",
    labelKey: "account.nav.invitations",
    icon: createElement(Mail),
    group: "Lore",
    groupKey: "account.nav.group.lore",
    order: 101,
    can: () => this.invitationApi.listMyInvitations.can(),
    lazy: () => import("./AccountInvitations.tsx"),
  });

  /**
   * What this account still wants to be told about. Gated on the read action
   * rather than on a permission: an action name resolves against
   * `/api/_links`, so the entry disappears for an app that never registered
   * the controller.
   */
  notifications = $settingsSection({
    dialog: this.account.dialog,
    name: "notifications",
    label: "Notifications",
    labelKey: "account.nav.notifications",
    icon: createElement(Bell),
    group: "Lore",
    groupKey: "account.nav.group.lore",
    order: 104,
    can: () => this.notificationApi.getMyNotificationPreferences.can(),
    lazy: () => import("./MyNotifications.tsx"),
  });
}
