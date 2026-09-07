import { ButtonInbox } from "@alepha/ui/components/button-inbox/button-inbox";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { AppRouter } from "../../AppRouter.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../services/I18n.ts";

/**
 * Lore's half of the bell: the localised labels, the destination, and a
 * router-driven open.
 *
 * ⚠️ **The count behind it is cross-project.** Alepha and Odzala are open in
 * the same session, and a ping in one must not be invisible from the other.
 * That stays true even though the bell renders only inside a project: what
 * the shell decides is where you can see it, not what it counts. The
 * project-scoped number is the sidebar's, and it is a different atom on
 * purpose.
 *
 * **"See all" carries the all-projects filter.** The dropdown lists messages
 * from every project, so a footer landing on the current project's filtered
 * view would show fewer rows than the menu it was clicked out of. The
 * sidebar entry keeps the project default; this link says all projects.
 */
const ProjectInboxButton = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);

  if (!project?.slug) {
    return null;
  }

  return (
    <ButtonInbox
      seeAllHref={`/${project.slug}/inbox?scope=all`}
      labels={{
        inbox: String(tr("inbox.title")),
        heading: String(tr("inbox.title")),
        empty: String(tr("inbox.empty")),
        markAllRead: String(tr("inbox.markAllRead")),
        seeAll: String(tr("inbox.seeAll")),
      }}
      // A push, not a full navigation: Lore has a router, and reloading the
      // document to reach a page one hop away throws the whole SPA away.
      onOpen={(href) => router.push(href)}
    />
  );
};

export default ProjectInboxButton;
