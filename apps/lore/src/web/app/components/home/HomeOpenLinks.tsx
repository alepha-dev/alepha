import { Button, ButtonGroup, cn } from "@alepha/ui";
import { Link, useRouter } from "alepha/react/router";
import type { LucideIcon } from "lucide-react";

import type { AppRouter } from "../../AppRouter.ts";

/**
 * One kind of open work in a project, and the page it lives on.
 */
export interface HomeOpenLink {
  kind: string;
  route:
    | "projectQuests"
    | "projectEpics"
    | "projectBlights"
    | "projectFeedback";
  icon: LucideIcon;
  count: number;
  /**
   * What the count is, in words ("12 open quests"): the button's accessible
   * name and its tooltip, since the icon alone does not say it.
   */
  label: string;
}

export interface HomeOpenLinksProps {
  projectSlug: string;
  links: HomeOpenLink[];
}

/**
 * The Home table's Open column: one button per kind of open work, joined in
 * a group, each a link to that kind's page in the project.
 *
 * Real anchors (`Link` rendered through `Button`), so each shows its URL on
 * hover, opens in a new tab on a modified click and offers "copy link
 * address", while a plain click still routes in place. `nativeButton={false}`
 * and `role="link"` for the reason the table's "New project" button gives:
 * Base UI otherwise assumes a `<button>` and overwrites the role.
 *
 * The group stops the click from reaching the row, which carries
 * `onRowClick` to the project's own page: without it a plain click would
 * navigate twice, and a modified one would open the tab AND navigate this
 * one.
 *
 * A zero is drawn, muted, rather than dropped. A button only exists when the
 * project has that feature on, so "nothing open" is an answer worth giving,
 * and a group whose buttons come and go would not line up from row to row.
 */
export const HomeOpenLinks = (props: HomeOpenLinksProps) => {
  const router = useRouter<AppRouter>();
  if (props.links.length === 0) return null;

  return (
    <ButtonGroup onClick={(e) => e.stopPropagation()}>
      {props.links.map((link) => {
        const Icon = link.icon;
        return (
          <Button
            key={link.kind}
            variant="outline"
            size="sm"
            nativeButton={false}
            role="link"
            aria-label={link.label}
            title={link.label}
            render={
              <Link
                href={router.path(link.route, {
                  params: { projectSlug: props.projectSlug },
                })}
              />
            }
            className={cn(
              "gap-1.5 font-semibold tabular-nums",
              link.count === 0 && "text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {link.count}
          </Button>
        );
      })}
    </ButtonGroup>
  );
};
