import { Badge, TimeAgo } from "@alepha/ui";
import { AccountPage } from "@alepha/ui/account";
import { DataTable } from "@alepha/ui/table";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { FolderKanban, Plus } from "lucide-react";

import type { ProjectOverviewResource } from "@/api/schemas/projectResourceSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";

/**
 * Every project the signed-in user belongs to, owned or joined, as a
 * `DataTable`.
 *
 * This page adds NO request of its own. It reads `userProjectsAtom`, the
 * complete membership list `getHomeOverview` returns, which the root layout
 * fills at bootstrap and `LoreAccountRouter.loadProjects` fills on a visit
 * that starts under `/account`. It is the same array Home slices its five
 * from, and capping the atom to make this page fetch would break
 * `Spotlight`'s client-side project search (see `recentProjectsCap.ts`). The
 * table is handed the array and pages it in memory.
 *
 * Ownership is a flag on the row, computed server-side from the member rank
 * in one batched read beside the area and quest counts. It used to compare
 * `project.createdBy` to the viewer, which stopped being an authorization
 * input in epic #E39 - and after an ownership transfer the two disagree.
 *
 * ⚠️ A boolean rather than the rank's name, on purpose: rank names are
 * per-project user data, so two projects can both have an "Admin" that means
 * different things. Ownership is the one fact that compares across projects,
 * and it is the fact this page already needs for the quota beside it.
 */
const MyProjects = () => {
  const { tr } = useI18n<I18n, "en">();
  const [overview] = useStore(userProjectsAtom);
  const router = useRouter<AppRouter>();

  const projects = overview?.projects ?? [];
  /*
   * The quota, counted from the same rows the page already shows
   * (feedback #P2146). Both halves come from `getHomeOverview`, which since
   * #Q2013 derives them through `ProjectSecurityService.ownedProjectIds` -
   * the one helper the CREATE path also counts through, so the number here
   * and the refusal there cannot disagree.
   *
   * ⚠️ Counted from `owner`, not from `projects.length`: this page lists
   * every project you belong to, and the quota is only on the ones you own.
   */
  const owned = projects.filter((project) => project.owner).length;
  const maxProjects = overview?.maxProjects;

  const projectPath = (project: ProjectOverviewResource) =>
    router.path("project", { params: { projectSlug: project.slug } });

  return (
    <AccountPage variant="table">
      <DataTable<ProjectOverviewResource>
        className="min-h-0 flex-1"
        data={projects}
        persistenceKey="lor.account.projects"
        // Every project on one page: an owner is capped well below this, and
        // the list is the complete set Home's "Show more" promises.
        defaultSize={100}
        defaultSort={{ field: "lastActivityAt", direction: "desc" }}
        onRowClick={(project) => void router.push(projectPath(project))}
        /*
          ⚠️ Shown whenever there is a limit, not only near it. A counter that
          appears at the ceiling is a counter nobody has seen when they were
          deciding whether to start something - which is the moment it is
          for. `maxProjects` is always sent, so the guard is for a page
          rendered before the overview lands.
        */
        toolbar={
          maxProjects !== undefined ? (
            <span
              className="text-muted-foreground text-sm"
              data-testid="project-quota"
            >
              {tr("account.projects.quota", {
                args: [String(owned), String(maxProjects)],
              })}
            </span>
          ) : undefined
        }
        actions={
          overview?.canCreate
            ? [
                {
                  icon: Plus,
                  label: tr("account.projects.create"),
                  primary: true,
                  onClick: () => void router.push("projectCreate"),
                },
              ]
            : []
        }
        emptyState={{
          icon: FolderKanban,
          title: tr("account.projects.empty"),
          description: tr("account.projects.description"),
        }}
        columns={{
          title: {
            label: tr("account.projects.col.project"),
            sortable: true,
            cell: (project) => (
              // A real link, so the project opens in a new tab on a
              // middle-click; the row click is the same destination.
              <Link
                href={projectPath(project)}
                data-testid="account-project-row"
                className="flex min-w-0 items-center gap-2 hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                <ProjectIcon
                  fileId={project.icon}
                  alt={project.title}
                  className="size-5 shrink-0"
                />
                <span className="truncate text-sm font-medium">
                  {project.title}
                </span>
              </Link>
            ),
          },
          owner: {
            label: tr("account.projects.col.role"),
            sortable: true,
            cell: (project) => (
              <Badge variant={project.owner ? "default" : "secondary"}>
                {project.owner
                  ? tr("account.projects.owner")
                  : tr("account.projects.member")}
              </Badge>
            ),
          },
          openQuestCount: {
            label: tr("account.projects.col.openQuests"),
            sortable: true,
            align: "right",
            cell: (project) => (
              <span className="text-muted-foreground text-xs tabular-nums">
                {project.openQuestCount}
              </span>
            ),
          },
          lastActivityAt: {
            label: tr("account.projects.col.lastActivity"),
            sortable: true,
            cell: (project) => (
              <TimeAgo
                value={project.lastActivityAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
        }}
      />
    </AccountPage>
  );
};

export default MyProjects;
