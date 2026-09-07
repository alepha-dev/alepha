import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ChevronRight } from "lucide-react";

import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";

/**
 * Every project the signed-in user belongs to, owned or joined.
 *
 * This page adds NO request. It reads `userProjectsAtom`, which
 * `getHomeOverview` already filled at bootstrap with the complete membership
 * list ordered most-recently-updated first — the same array Home slices its
 * five from. Fetching here would be a second copy of data already in memory,
 * and capping the atom to make this page necessary would break `Spotlight`'s
 * client-side project search. See `recentProjectsCap.ts`.
 *
 * Ownership is a flag on the row, computed server-side from `members.rank`
 * in one batched read beside the area and quest counts. It used to compare
 * `project.createdBy` to the viewer, which stopped being an authorization
 * input in epic #E39 - and after an ownership transfer the two disagree.
 *
 * ⚠️ A boolean rather than the rank's name, on purpose: rank names are
 * per-project user data, so two projects can both have an "Admin" that means
 * different things, and a chip on twenty rows would be noise. Ownership is the
 * one fact that compares across projects, and it is the fact this page already
 * needs for the quota line beside it. A member's rank is one click away, on
 * the project, where the matrix explains it.
 */
const MyProjects = () => {
  const { tr } = useI18n<I18n, "en">();
  const [overview] = useStore(userProjectsAtom);
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);

  const projects = [...(overview?.projects ?? [])].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1,
  );
  /*
   * The quota, counted from the same rows the page already shows
   * (feedback #P2146). Both halves come from `getHomeOverview`, which since
   * #Q2013 derives them through `ProjectSecurityService.ownedProjectIds` -
   * the one helper the CREATE path also counts through, so the number here
   * and the refusal there cannot disagree. Before that fix they did: the
   * create path counted membership rows with no join, so a reader saw 8 and
   * was refused at 15.
   *
   * ⚠️ Counted from `owner`, not from `projects.length`: this page lists
   * every project you belong to, and the quota is only on the ones you own.
   */
  const owned = projects.filter((project) => project.owner).length;
  const maxProjects = overview?.maxProjects;

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeading
        title={String(tr("account.projects.title"))}
        description={String(tr("account.projects.description"))}
      />

      {/* ⚠️ Shown whenever there is a limit, not only near it. A counter
          that appears at the ceiling is a counter nobody has seen when they
          were deciding whether to start something - which is the moment it
          is for. The other moment is the refusal, and that message already
          exists on Home and in the switcher.

          `maxProjects` is always sent, so the guard is for a page rendered
          before the overview lands rather than for a plan without a
          limit. */}
      {maxProjects !== undefined && (
        <p
          className="text-muted-foreground text-sm"
          data-testid="project-quota"
        >
          {tr("account.projects.quota", {
            args: [String(owned), String(maxProjects)],
          })}
        </p>
      )}

      {projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {tr("account.projects.empty")}
        </p>
      ) : (
        <Card className="p-0">
          <CardContent className="flex flex-col divide-y p-0">
            {projects.map((project) => {
              const owner = project.owner;
              return (
                <Link
                  key={project.id}
                  href={router.path("project", {
                    params: { projectSlug: project.slug },
                  })}
                  data-testid="account-project-row"
                  className="hover:bg-accent/50 flex items-center gap-3 px-4 py-3 transition-colors"
                >
                  <ProjectIcon
                    fileId={project.icon}
                    alt={project.title}
                    className="size-5 shrink-0"
                  />
                  <span className="truncate text-sm font-medium">
                    {project.title}
                  </span>
                  {owner !== undefined && (
                    <Badge
                      variant={owner ? "default" : "secondary"}
                      className="shrink-0"
                    >
                      {owner
                        ? tr("account.projects.owner")
                        : tr("account.projects.member")}
                    </Badge>
                  )}
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {String(
                      tr("account.projects.updated", {
                        args: [String(dt.of(project.updatedAt).fromNow())],
                      }),
                    )}
                  </span>
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MyProjects;
