import { Badge, Skeleton, TimeAgo } from "@alepha/ui";
import { AccountPage } from "@alepha/ui/account";
import { DataTable, type DataTableFilterFields } from "@alepha/ui/table";
import { z } from "alepha";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Archive, FolderKanban, Plus, UserRound } from "lucide-react";

import type { ProjectOverviewResource } from "../../../../api/schemas/projectResourceSchema.ts";
import { USER_DOCK_CAP } from "../../../../api/schemas/userDockCap.ts";
import { userDockAtom } from "../../atoms/userDockAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import { ProjectRailCard } from "../project/ProjectRailCard.tsx";
import { useDock } from "../project/useDock.ts";
import { MyProjectsPinSwitch } from "./MyProjectsPinSwitch.tsx";
import { useUserProjects } from "./useUserProjects.ts";

/**
 * Every project the signed-in user belongs to, owned or joined, as a
 * `DataTable`.
 *
 * This page adds NO request of its own. It reads `userProjectsAtom`, the
 * complete membership list `getHomeOverview` returns, which the root layout
 * fills at bootstrap and `useUserProjects` fills when the dialog opens over
 * a page outside that layout. It is the same array Home slices its five
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
 * which is why it is the Role filter.
 *
 * #Q3412 took the "N of 100 projects owned" counter out of the toolbar and
 * put filters there instead: a title search, Role (owner or member) and
 * Archived. Archived projects are hidden on load (`initialValues`): they
 * left the switcher, Spotlight and Home (#Q2601), and this page is where
 * they are found again, by asking for them.
 *
 * #Q3547 took the "n / 20 pinned" counter out too. The cap still holds:
 * at twenty, an unpinned project's switch is held off and its tooltip says
 * why (`MyProjectsPinSwitch`), so the refusal is explained where it happens.
 */
const MyProjects = () => {
  const { tr } = useI18n<I18n, "en">();
  const [overview] = useStore(userProjectsAtom);
  const [dock] = useStore(userDockAtom);
  const dockActions = useDock();
  // Untyped on purpose: this navigates to a name or href a module
  // supplies at runtime (a registry entry, a search row), which core's
  // registered routers cannot name.
  const router = useRouter<any>();
  const loaded = useUserProjects();

  const projects = overview?.projects ?? [];
  // The pins this page manages (#E139, #Q3440): which ones, never their
  // order, which is changed on the dock. Counted against live, unarchived
  // memberships, as the dock itself draws them.
  const live = new Set(
    projects.filter((it) => !it.archivedAt).map((it) => it.id),
  );
  const pinned = new Set((dock ?? []).filter((id) => live.has(id)));
  const dockFull = pinned.size >= USER_DOCK_CAP;
  const pinBusy = dockActions.pin.loading || dockActions.unpin.loading;
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
  const filterFields = {
    search: { preset: "search" },
    role: {
      schema: z.enum(["owner", "member"]),
      label: tr("account.projects.filter.role"),
      icon: UserRound,
      // Off the bar until added, from "+" or the Role column's header
      // (#Q3599): Archived: No is the only default filter.
      column: "owner",
      optionLabel: (role: "owner" | "member") =>
        role === "owner"
          ? tr("account.projects.owner")
          : tr("account.projects.member"),
      control: { clearLabel: tr("account.projects.filter.allRoles") },
    },
    archived: {
      schema: z.enum(["active", "archived"]),
      label: tr("account.projects.filter.archived"),
      icon: Archive,
      mode: "default",
      // Yes and No (#Q3562): the filter's label already says what it asks,
      // so the chip reads "Archived: No" rather than "Archived: Not
      // archived". The values stay `active` / `archived`, which a saved
      // filter in the browser already holds.
      optionLabel: (state: "active" | "archived") =>
        state === "archived"
          ? tr("account.projects.filter.archived.yes")
          : tr("account.projects.filter.archived.no"),
      control: { clearLabel: tr("account.projects.filter.allStates") },
    },
  } satisfies DataTableFilterFields;

  const projectPath = (project: ProjectOverviewResource) =>
    router.path("project", { params: { projectSlug: project.slug } });

  if (!loaded) {
    return (
      <AccountPage variant="table">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-40 w-full" />
      </AccountPage>
    );
  }

  return (
    <AccountPage variant="table">
      <DataTable<ProjectOverviewResource, typeof filterFields>
        className="min-h-0 flex-1"
        data={projects}
        // Light enough for the account dialog: the compact pager, compact
        // rows, and the toolbar down to its filters and the create action.
        pagination="compact"
        density="compact"
        hideColumnPicker
        hideActionsMenu
        persistenceKey="lor.account.projects"
        // Every project on one page: an owner is capped well below this, and
        // the list is the complete set Home's "Show more" promises.
        defaultSize={100}
        defaultSort={{ field: "lastActivityAt", direction: "desc" }}
        onRowClick={(project) => void router.push(projectPath(project))}
        filters={{
          fields: filterFields,
          initialValues: { archived: "active" },
        }}
        // The filter keys are not fields of the row, so they are matched
        // here rather than by the table's field-by-field default.
        filter={(project, values) =>
          (!values.search ||
            project.title
              .toLowerCase()
              .includes(values.search.toLowerCase())) &&
          (!values.role || (values.role === "owner") === project.owner) &&
          (!values.archived ||
            (values.archived === "archived") === !!project.archivedAt)
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
              // The rail's hover card, compact (#Q3411): image, title and
              // repository, so the list and the rail show a project alike.
              <ProjectRailCard
                compact
                project={project}
                title={
                  // A real link, so the project opens in a new tab on a
                  // middle-click; the row click is the same destination.
                  <Link
                    href={projectPath(project)}
                    data-testid="account-project-row"
                    className="hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {project.title}
                  </Link>
                }
                badge={
                  // Archived projects leave the switcher, Spotlight and Home
                  // (#Q2601); this page is where they stay, so it says which.
                  project.archivedAt ? (
                    <Badge
                      variant="secondary"
                      className="shrink-0"
                      data-testid="account-project-archived"
                    >
                      {tr("account.projects.archived")}
                    </Badge>
                  ) : null
                }
              />
            ),
          },
          pinned: {
            label: tr("account.projects.col.pinned"),
            cell: (project) => (
              <MyProjectsPinSwitch
                project={project}
                pinned={pinned.has(project.id)}
                full={dockFull}
                busy={pinBusy}
                onChange={(next) =>
                  void (next
                    ? dockActions.pin.run(project.id)
                    : dockActions.unpin.run(project.id))
                }
              />
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
