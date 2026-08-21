import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
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
 * Ownership is derived, not fetched: `projectResourceSchema` extends the
 * entity, so every row already carries `createdBy`, and the owner is whoever
 * created it (`AppSecurityProvider.assertOwner` uses the same comparison).
 * There is no role or membership level to read — owning the project is the
 * whole distinction.
 */
const MyProjects = () => {
  const { tr } = useI18n<I18n, "en">();
  const [overview] = useStore(userProjectsAtom);
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);
  const auth = useAuth();

  const projects = [...(overview?.projects ?? [])].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1,
  );

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeading
        title={String(tr("account.projects.title"))}
        description={String(tr("account.projects.description"))}
      />

      {projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {tr("account.projects.empty")}
        </p>
      ) : (
        <Card className="p-0">
          <CardContent className="flex flex-col divide-y p-0">
            {projects.map((project) => {
              // `auth.user` is undefined for the one frame before auth
              // resolves. Treating that as "not owner" would flash a Member
              // badge on a project the reader owns, so the badge waits for a
              // real answer rather than guessing a default.
              const owner = auth.user
                ? project.createdBy === auth.user.id
                : undefined;
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
