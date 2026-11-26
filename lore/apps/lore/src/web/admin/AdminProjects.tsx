import { Badge, cn, textLinkUnderlineClassName } from "@alepha/ui";
import { AdminPage, useConfirmedAction } from "@alepha/ui/admin";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import type { AdminProjectController } from "@lore/core/api";
import type { AdminProjectResource } from "@lore/core/schemas";
import { AlephaError, z } from "alepha";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Activity, Archive, ArchiveRestore, LogIn, Trash2 } from "lucide-react";
import { useCallback } from "react";

/**
 * Instance-wide projects list, mounted into the shared admin shell by
 * `LoreAdminRouter`.
 *
 * This is an application-owned page living inside `@alepha/ui`'s
 * `AdminRouter` — the composition `$pageAdmin` exists for. It sits in the
 * same sidebar as the built-in Users / Sessions / Jobs pages without
 * `@alepha/ui` knowing anything about Lore.
 */
export const AdminProjects = () => {
  const client = useClient<AdminProjectController>();
  const { l } = useI18n();

  // Literal English, like the rest of the Lore admin: it is untranslated.
  const filterFields = {
    search: {
      preset: "search",
      placeholder: "Search projects…",
      control: { inputProps: { "aria-label": "Search projects by title" } },
    },
    // Clearing means "any activity": the empty value is the third option
    // rather than a separate "All" entry to keep selected.
    activity: {
      schema: z.enum(["active", "dormant"]),
      label: "Activity",
      icon: Activity,
      items: [
        { value: "active", label: "Active (30d)" },
        { value: "dormant", label: "Dormant (30d+)" },
      ],
      control: { clearLabel: "Any activity" },
    },
    // The dashboard's Projects tile links here with `?archived=exclude`.
    // Clearing means every project, archived included, as the page always
    // listed them.
    //
    // Yes and No (#Q3888), as on My projects: the filter's label already
    // says what it asks, so the chip reads "Archived: No" rather than
    // "Archived: Not archived". The values stay `only` / `exclude`, which
    // the tile's link and a saved filter already hold.
    archived: {
      schema: z.string(),
      label: "Archived",
      icon: Archive,
      items: [
        { value: "only", label: "Yes" },
        { value: "exclude", label: "No" },
      ],
      control: { clearLabel: "Archived or not" },
    },
  } satisfies DataTableFilterFields;

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: DataTableFilterValues<typeof filterFields>;
    }) => {
      return client.findProjects({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          search: params.filters?.search || undefined,
          activity: params.filters?.activity || undefined,
          archived: params.filters?.archived || undefined,
        },
      });
    },
    [client],
  );

  /**
   * Archive or unarchive (#Q4051): an archived project stays, read-only for
   * everyone, until unarchived. Both are confirmed: the operator acts on a
   * project they may not belong to.
   */
  const archive = useConfirmedAction<
    [AdminProjectResource, boolean, () => void]
  >(
    {
      confirm: (project, archived) =>
        archived
          ? {
              title: "Archive project",
              description: `Archive "${project.title}" (#${project.id})? It becomes read-only for everyone: nothing in it can be changed until it is unarchived. Nothing is deleted.`,
              confirmLabel: "Archive",
            }
          : {
              title: "Unarchive project",
              description: `Unarchive "${project.title}" (#${project.id})? Its members can change it again.`,
              confirmLabel: "Unarchive",
            },
      handler: async (project, archived, refresh) => {
        await client.adminSetProjectArchived({
          params: { id: project.id },
          body: { archived },
        });
        refresh();
      },
      success: (project, archived) =>
        archived
          ? `Archived "${project.title}"`
          : `Unarchived "${project.title}"`,
    },
    [client],
  );

  /**
   * Join a project as the instance admin (#Q4538): the only way an admin
   * gets inside one, since every project gate answers a non-member 404. The
   * confirm says the members will see it, because the project's Activity
   * records it.
   */
  const join = useConfirmedAction<[AdminProjectResource, () => void]>(
    {
      confirm: (project) => ({
        title: "Join project",
        description: `Join "${project.title}" (#${project.id}) as an instance admin? Its members will see it: the project's activity records that an instance admin joined. You leave it like any member.`,
        confirmLabel: "Join",
      }),
      handler: async (project, refresh) => {
        await client.adminJoinProject({ params: { id: project.id } });
        refresh();
      },
      success: (project) => `Joined "${project.title}"`,
    },
    [client],
  );

  /**
   * Deleting a project takes its members and quests with it and cannot be
   * undone, so the confirmation names the project rather than asking a generic
   * "are you sure" the operator will click through on reflex.
   */
  const deleteProject = useConfirmedAction<[AdminProjectResource, () => void]>(
    {
      confirm: (project) => ({
        title: "Delete project",
        description: `Delete "${project.title}" (#${project.id})? Its members and quests go with it. This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }),
      handler: async (project, refresh) => {
        await client.deleteProject({ params: { id: project.id } });
        refresh();
      },
      success: (project) => `Deleted "${project.title}"`,
    },
    [client],
  );

  /**
   * The bulk confirmation carries the count and the titles — a checkbox
   * selection is easy to get wrong by one row, and the dialog is the last
   * place that mistake is still recoverable.
   */
  const bulkDelete = useConfirmedAction<
    [
      AdminProjectResource[],
      { clearSelection: () => void; refresh: () => void },
    ]
  >(
    {
      confirm: (projects) => ({
        title: "Delete projects",
        description: `Delete ${projects.length} project(s) — ${projects
          .map((project) => project.title)
          .join(
            ", ",
          )}? Their members and quests go with them. This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }),
      handler: async (projects, ctx) => {
        const res = await client.deleteProjects({
          body: { ids: projects.map((project) => project.id) },
        });
        ctx.clearSelection();
        ctx.refresh();
        // Reported rather than assumed: the endpoint returns what it actually
        // removed, so a partial result is visible instead of implied by a 200.
        if (res.deleted.length !== projects.length) {
          throw new AlephaError(
            `Deleted ${res.deleted.length} of ${projects.length} projects`,
          );
        }
      },
      success: (projects) => `Deleted ${projects.length} project(s)`,
    },
    [client],
  );

  return (
    <AdminPage>
      <DataTable<AdminProjectResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey="lore.admin.projects"
        fetch={fetcher}
        filters={{ fields: filterFields, fromQuery: ["archived"] }}
        bulkActions={[
          {
            label: "Delete selected",
            icon: Trash2,
            destructive: true,
            onClick: (items, ctx) => bulkDelete.run(items, ctx),
          },
        ]}
        rowActions={(project) => [
          // Offered to an admin who is not a member yet (#Q4538).
          ...(project.joined
            ? []
            : [
                {
                  label: "Join",
                  icon: LogIn,
                  onClick: (
                    _project: AdminProjectResource,
                    { refresh }: { refresh: () => void },
                  ) => void join.run(project, refresh),
                },
              ]),
          {
            // Read-only while archived (#Q4051); unarchiving brings it back.
            label: project.archivedAt ? "Unarchive" : "Archive",
            icon: project.archivedAt ? ArchiveRestore : Archive,
            onClick: (
              _project: AdminProjectResource,
              { refresh }: { refresh: () => void },
            ) => void archive.run(project, !project.archivedAt, refresh),
          },
          {
            label: "Delete project",
            icon: Trash2,
            destructive: true,
            onClick: (
              _project: AdminProjectResource,
              { refresh }: { refresh: () => void },
            ) => deleteProject.run(project, refresh),
          },
        ]}
        columns={{
          title: {
            label: "Title",
            sortable: true,
            cell: (project) => (
              <span className="font-medium">{project.title}</span>
            ),
          },
          id: {
            label: "ID",
            cell: (project) => (
              <code className="text-muted-foreground text-xs">
                #{project.id}
              </code>
            ),
          },
          status: {
            label: "Status",
            cell: (project) =>
              project.archivedAt ? (
                <Badge
                  variant="tint"
                  tone="neutral"
                  title={`Archived ${l(project.archivedAt, { date: "lll" })}`}
                  data-testid="project-status"
                >
                  archived
                </Badge>
              ) : (
                <Badge
                  variant="tint"
                  tone="success"
                  data-testid="project-status"
                >
                  active
                </Badge>
              ),
          },
          memberCount: {
            label: "Members",
            cell: (project) => (
              <span className="tabular-nums">{project.memberCount}</span>
            ),
          },
          createdBy: {
            label: "Owner",
            /*
             * A real `<a href>` rather than a click handler, so the row keeps
             * cmd-click, middle-click and "copy link address" — the admin
             * users table links out the same way.
             *
             * Falls back to the truncated id when the account no longer
             * resolves: `projects.createdBy` has no foreign key to `users`, so
             * an owner can genuinely be missing, and showing nothing would
             * read as a rendering bug rather than a deleted account.
             */
            cell: (project) => (
              <Link
                href={`/admin/users/${project.createdBy}`}
                className={cn(
                  textLinkUnderlineClassName,
                  "hover:text-foreground",
                )}
              >
                {project.ownerUsername ?? (
                  <code className="text-muted-foreground text-xs">
                    {project.createdBy.slice(0, 8)}
                  </code>
                )}
              </Link>
            ),
          },
          createdAt: {
            label: "Created",
            sortable: true,
            cell: (project) => (
              <span className="text-muted-foreground text-xs">
                {l(project.createdAt, { date: "ll" })}
              </span>
            ),
          },
          /*
           * Shown because the activity filter is judged on it. Filtering rows
           * out on a value the operator cannot see makes the table look like
           * it is lying — especially right before they select and delete.
           */
          updatedAt: {
            label: "Updated",
            sortable: true,
            cell: (project) => (
              <span className="text-muted-foreground text-xs">
                {project.updatedAt ? l(project.updatedAt, { date: "ll" }) : "—"}
              </span>
            ),
          },
        }}
      />
    </AdminPage>
  );
};

export default AdminProjects;
