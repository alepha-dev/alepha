import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { type Infer, z } from "alepha";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Activity, Search, Trash2 } from "lucide-react";
import { useCallback } from "react";

import type { AdminProjectController } from "@/api/controllers/AdminProjectController.ts";
import type { AdminProjectResource } from "@/api/schemas/adminProjectResourceSchema.ts";

/**
 * Instance-wide projects list, mounted into the shared admin shell by
 * `LoreAdminRouter`.
 *
 * This is an application-owned page living inside `@alepha/ui`'s
 * `AdminRouter` — the composition `$pageAdmin` exists for. It sits in the
 * same sidebar as the built-in Users / Sessions / Jobs pages without
 * `@alepha/ui` knowing anything about Lore.
 */
/*
 * Module scope so the reference is stable across renders — `AlephaTable`'s
 * internal `useForm` captures it once, and a fresh object per render would
 * re-anchor the form initialization for nothing.
 */
const filtersSchema = z.object({
  search: z.string().optional(),
  activity: z.string().optional(),
});
type AdminProjectFilters = Infer<typeof filtersSchema>;

export const AdminProjects = () => {
  const client = useClient<AdminProjectController>();
  const { l } = useI18n();

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: AdminProjectFilters;
    }) => {
      return client.findProjects({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          search: params.filters?.search || undefined,
          activity: params.filters?.activity || undefined,
        },
      });
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
          throw new Error(
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
      <AlephaTable<AdminProjectResource>
        className="min-h-0 flex-1"
        persistenceKey="lore.admin.projects"
        fetch={fetcher}
        filters={{
          schema: filtersSchema,
          render: (form) => (
            <div className="flex items-center gap-2">
              <div className="w-72">
                <Control
                  input={form.input.search}
                  label=""
                  icon={Search}
                  placeholder="Search projects…"
                  inputProps={{ "aria-label": "Search projects by title" }}
                />
              </div>
              {/*
                Clearing means "any activity" — the empty value is the third
                option rather than a separate "All" entry to keep selected.
              */}
              <Control
                input={form.input.activity}
                label=""
                clearable
                icon={Activity}
                clearLabel="Any activity"
                triggerClassName="w-44"
                items={[
                  { value: "active", label: "Active (30d)" },
                  { value: "dormant", label: "Dormant (30d+)" },
                ]}
              />
            </div>
          ),
        }}
        bulkActions={[
          {
            label: "Delete selected",
            icon: Trash2,
            destructive: true,
            onClick: (items, ctx) => bulkDelete.run(items, ctx),
          },
        ]}
        rowActions={(project) => [
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
                className="hover:text-foreground underline-offset-4 hover:underline"
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
                {String(l(project.createdAt, { date: "ll" }))}
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
                {project.updatedAt
                  ? String(l(project.updatedAt, { date: "ll" }))
                  : "—"}
              </span>
            ),
          },
        }}
      />
    </AdminPage>
  );
};

export default AdminProjects;
