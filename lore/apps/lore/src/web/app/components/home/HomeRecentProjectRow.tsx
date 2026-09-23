import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Crown } from "lucide-react";

import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";
import { HomeMomentum } from "./HomeMomentum.tsx";
import { type HomeOpenLink, HomeOpenLinks } from "./HomeOpenLinks.tsx";

export interface HomeRecentProjectRowProps {
  project: ProjectOverviewResource;
  /**
   * The project's daily counts, or an empty series when the strip could not
   * be read at all (see `HomeMomentum`).
   */
  counts: number[];
  days: string[];
  /**
   * The busiest day across every row, so the bars compare projects.
   */
  ceiling: number;
  inactive: boolean;
  openLinks: HomeOpenLink[];
}

/**
 * One project in Home's list: its name, fourteen days of momentum, and what
 * is open in it.
 *
 * The whole row opens the project through a stretched link: the name's anchor
 * spreads an `::after` over the row, so the row is one target with the URL on
 * hover and a real "open in new tab", and nothing needs a click handler. The
 * momentum strip and the Open buttons sit above that layer (`relative z-10`),
 * so their own hover and links keep working. A row that WAS a link could not
 * hold the Open buttons: an anchor inside an anchor is invalid HTML.
 *
 * Three columns, the outer two equal (`1fr auto 1fr`), so the momentum strip
 * sits on the row's centre line whatever the name's length and however many
 * Open buttons the project has. Below `md` the strip is hidden and the row is
 * two columns; on a phone the Open buttons drop under the name, which would
 * otherwise be truncated to a letter or two.
 *
 * From `md` the row has a fixed height, tall enough for the momentum strip:
 * the strip arrives with the board, after the list, and a row sized by its
 * content grew by twenty pixels under the reader when it did.
 */
export const HomeRecentProjectRow = (props: HomeRecentProjectRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const total = props.counts.reduce((sum, count) => sum + count, 0);

  return (
    <li
      data-testid="home-project-row"
      className="hover:bg-muted/40 relative grid grid-cols-1 items-center gap-x-4 gap-y-1.5 border-b px-3 py-1.5 transition-colors last:border-b-0 sm:grid-cols-[1fr_auto] md:h-16 md:grid-cols-[1fr_auto_1fr] md:py-0"
    >
      <div className="flex min-w-0 items-center gap-3">
        <ProjectIcon
          fileId={props.project.icon}
          className="size-8 shrink-0 rounded-md"
          alt={props.project.title}
        />
        <Link
          href={router.path("project", {
            params: { projectSlug: props.project.slug },
          })}
          className="truncate font-medium after:absolute after:inset-0"
        >
          {props.project.title}
        </Link>
        {props.project.owner && (
          <Crown
            className="text-muted-foreground size-3.5 shrink-0"
            aria-label={tr("home.table.owner")}
          />
        )}
      </div>
      <div className="relative z-10 max-md:hidden">
        <HomeMomentum
          counts={props.counts}
          days={props.days}
          ceiling={props.ceiling}
          label={tr("home.table.momentum.label", {
            args: [String(total), String(props.days.length)],
          })}
          inactive={props.inactive}
        />
      </div>
      <div className="relative z-10 flex justify-start pl-11 sm:justify-end sm:pl-0">
        <HomeOpenLinks
          projectSlug={props.project.slug}
          links={props.openLinks}
        />
      </div>
    </li>
  );
};
