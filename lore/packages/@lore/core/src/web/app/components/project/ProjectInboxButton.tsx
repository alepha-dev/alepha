import { useSettingsDialog } from "@alepha/ui/settings";
import { ButtonInbox } from "@alepha/ui/shell";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";

/**
 * Lore's half of the bell: the localised labels, the destination, and a
 * router-driven open.
 *
 * ⚠️ **The count behind it is cross-project.** Two projects are open in
 * the same session, and a ping in one must not be invisible from the other.
 * That stays true even though the bell renders only inside a project: what
 * the shell decides is where you can see it, not what it counts. The
 * project-scoped number is the sidebar's, and it is a different atom on
 * purpose.
 *
 * **"See all" opens the account dialog's Inbox** (#Q3564), on all projects:
 * the dropdown lists messages from every project, so a footer landing on a
 * filtered view would show fewer rows than the menu it was clicked out of.
 * The href is this page with `?account=inbox`, which opens the same section
 * from a link made anywhere; the click opens it in place, with no
 * navigation, so the page under the dialog does not reload.
 */
const ProjectInboxButton = () => {
  const { tr } = useI18n<I18n, "en">();
  // Untyped on purpose: this navigates to a name or href a module
  // supplies at runtime (a registry entry, a search row), which core's
  // registered routers cannot name.
  const router = useRouter<any>();
  const [project] = useStore(currentProjectAtom);
  const account = useSettingsDialog("account");

  if (!project?.slug) {
    return null;
  }

  const seeAll = `${router.pathname}?account=inbox`;

  return (
    <ButtonInbox
      seeAllHref={seeAll}
      labels={{
        inbox: tr("inbox.title"),
        heading: tr("inbox.title"),
        empty: tr("inbox.empty"),
        markAllRead: tr("inbox.markAllRead"),
        seeAll: tr("inbox.seeAll"),
      }}
      // A push, not a full navigation: Lore has a router, and reloading the
      // document to reach a page one hop away throws the whole SPA away.
      onOpen={(href) =>
        href === seeAll ? account.open("inbox") : router.push(href)
      }
    />
  );
};

export default ProjectInboxButton;
