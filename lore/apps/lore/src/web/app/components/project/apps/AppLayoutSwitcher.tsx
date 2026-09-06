import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { ChevronDown } from "lucide-react";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * Cross to another copy of the SAME app.
 *
 * Sits on the instance half of the plate, because that is the half it changes:
 * the app is what these rows have in common and the env is what tells them
 * apart. Only siblings are offered - crossing to a different app is what the
 * Apps list is for, and a menu holding every instance in the project would be a
 * second, worse copy of it.
 *
 * Absent when there is nothing to cross to, which is the common case: one
 * deployed copy is one row, and a chevron that opens a menu of one is a control
 * that changes nothing.
 *
 * ⚠️ It navigates to the OVERVIEW rather than to the tab that is open. A
 * sibling need not have unlocked the same tabs - `club/production` may hold a
 * sigil where `club/staging` does not - and landing on a tab that does not
 * exist there would 404 for a reason the reader cannot see. `AppLayout`'s own
 * redirect catches that case too; this avoids provoking it.
 */
const AppLayoutSwitcher = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();

  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);
  const [instances] = useStore(currentInstancesAtom);

  if (!project || !instance) {
    return null;
  }

  const siblings = (instances ?? [])
    .filter((it) => it.app === instance.app && it.id !== instance.id)
    .sort((a, b) => a.env.localeCompare(b.env));

  if (siblings.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={String(tr("app.switcher.label"))}
        className="text-muted-foreground hover:text-foreground -ml-1 inline-flex items-center rounded p-0.5 transition-colors"
      >
        <ChevronDown className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {siblings.map((sibling) => (
          <DropdownMenuItem
            key={sibling.id}
            onClick={() =>
              void router.push("app", {
                params: {
                  projectSlug: project.slug,
                  app: sibling.app,
                  env: sibling.env,
                },
              })
            }
          >
            {sibling.env}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AppLayoutSwitcher;
