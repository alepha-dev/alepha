import { $pageAccount, AccountRouter } from "@alepha/ui/account";
import { $inject, Alepha } from "alepha";
import { $client } from "alepha/server/links";
import { Bell, FolderKanban, Mail } from "lucide-react";
import { createElement } from "react";

import type { InvitationController } from "../../../../api/controllers/InvitationController.ts";
import type { NotificationPreferenceController } from "../../../../api/controllers/NotificationPreferenceController.ts";
import type { ProjectController } from "../../../../api/controllers/ProjectController.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";

/**
 * Lore's own pages inside the shared `/account` area.
 *
 * The five built-in pages — Profile, Security, Sessions, API keys, Connected
 * apps — arrive with `AccountRouter`; declaring anything here with
 * `$pageAccount` registers it. What Lore adds is the two surfaces the
 * framework knows nothing about.
 *
 * ⚠️ **Icons are `createElement(Icon)`, never `<Icon />`** — same reason as
 * `AdminRouter` and `AccountRouter`: this class is evaluated eagerly in the
 * server graph, which `alepha db migrations create` imports under `tsx`, where
 * the classic JSX transform emits a bare `React.createElement`.
 *
 * Every page takes an order in 100-999 in its own `Lore` group, as
 * `$pageAccount` requires: the built-ins occupy `Account` (1) and `Security`
 * (1000-1003), and groups sort by their smallest member, so the Lore group
 * sits between the two. Projects leads it at exactly 100.
 *
 * ⚠️ **`/account` is a root shell, not a child of `AppRouter.layout`** (#E68).
 * Nothing that layout provides reaches these pages: not its loader (which
 * fills `userProjectsAtom`), not its `Toaster` or Spotlight. The account
 * shell brings its own chrome; the atom is filled by {@link loadProjects}.
 * The 401 redirect is `$secure()` on the account layout, which sends a
 * signed-out visitor to the `login` route with `?redirect=`.
 */
export class LoreAccountRouter {
  protected readonly alepha = $inject(Alepha);
  protected readonly account = $inject(AccountRouter);
  protected readonly projectApi = $client<ProjectController>();
  protected readonly invitationApi = $client<InvitationController>();
  protected readonly notificationApi =
    $client<NotificationPreferenceController>();

  /**
   * Fills `userProjectsAtom` when nothing has yet.
   *
   * `AppRouter.layout`'s loader fills it on every page under that layout,
   * and a visit that starts there arrives here with the list in memory. A
   * visit that starts on `/account/*` never runs that loader, since the
   * account shell is a root of its own, so the pages that read the atom
   * load it themselves, once.
   */
  protected async loadProjects(): Promise<void> {
    if (!this.alepha.store.get(userProjectsAtom)) {
      this.alepha.store.set(
        userProjectsAtom,
        await this.projectApi.getHomeOverview(),
      );
    }
  }

  /**
   * The complete project list, behind Home's and the switcher's five.
   *
   * No `can()`: every signed-in user has projects to list, even if the list
   * is empty, unlike the pages below whose endpoints are permission-gated.
   */
  projects = $pageAccount({
    path: "/projects",
    name: "accountProjects",
    head: this.account.accountHead("Projects"),
    loader: () => this.loadProjects(),
    nav: {
      label: "Projects",
      icon: createElement(FolderKanban),
      group: "Lore",
      order: 100,
    },
    lazy: () => import("./MyProjects.tsx"),
  });

  invitations = $pageAccount({
    path: "/invitations",
    name: "accountInvitations",
    head: this.account.accountHead("Invitations"),
    // `AccountInvitations` reads the atom to find the project it just joined.
    loader: () => this.loadProjects(),
    can: () => this.invitationApi.listMyInvitations.can(),
    nav: {
      label: "Invitations",
      icon: createElement(Mail),
      group: "Lore",
      order: 101,
    },
    lazy: () => import("./AccountInvitations.tsx"),
  });

  /**
   * The estates the caller owns (#1838): the machines lent to projects as
   * deploy destinations, with the switches and the secret no project page
   * shows because neither belongs to a project. Gated on the list action
   * like the two above. Order 103: the next free slot in the Lore group,
   * never below 100.
   */
  /**
   * What this account still wants to be told about.
   *
   * Order 104, the next free slot in the Lore group. Gated on the read
   * action rather than on a permission, like the three above: an action name
   * resolves against `/api/_links`, so the entry disappears for an app that
   * never registered the controller, while a permission is self-declaring
   * whether or not anything backs it.
   */
  notifications = $pageAccount({
    path: "/notifications",
    name: "accountNotifications",
    head: this.account.accountHead("Notifications"),
    can: () => this.notificationApi.getMyNotificationPreferences.can(),
    nav: {
      label: "Notifications",
      icon: createElement(Bell),
      group: "Lore",
      order: 104,
    },
    lazy: () => import("./MyNotifications.tsx"),
  });
}
