import { AdminPage } from "@alepha/ui/components/admin/admin-page";
import { useConfirmedAction } from "@alepha/ui/components/admin/use-confirmed-action";
import { AlephaTable } from "@alepha/ui/components/alepha-table/alepha-table";
import { Control } from "@alepha/ui/components/control/control";
import { Badge } from "@alepha/ui/components/ui/badge";
import { type Infer, z } from "alepha";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Search, Trash2 } from "lucide-react";
import { useCallback } from "react";

import type { AdminEstateController } from "@/api/controllers/AdminEstateController.ts";
import type { AdminEstateResource } from "@/api/schemas/adminEstateResourceSchema.ts";

/**
 * Instance-wide estates list, mounted into the shared admin shell by
 * `LoreAdminRouter` (#1838).
 *
 * The backstop for an estate whose owner is gone or unresponsive. An admin
 * sees every estate and can delete one; an admin can never read a
 * credential, and this page has no column for one. The delete confirmation
 * says what deleting does not do, for the same reason the owner's does:
 * nothing is undeployed, and a `cloudflare` credential is not revoked at
 * Cloudflare.
 */
/*
 * Module scope so the reference is stable across renders, as in
 * `AdminProjects`.
 */
const filtersSchema = z.object({
  search: z.string().optional(),
});
type AdminEstateFilters = Infer<typeof filtersSchema>;

export const AdminEstates = () => {
  const client = useClient<AdminEstateController>();
  const { l } = useI18n();

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: AdminEstateFilters;
    }) => {
      return client.findEstates({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          search: params.filters?.search || undefined,
        },
      });
    },
    [client],
  );

  const deleteEstate = useConfirmedAction<[AdminEstateResource, () => void]>(
    {
      confirm: (estate) => ({
        title: "Delete estate",
        description: `Delete "${estate.slug}"? Its secret stops working and every project it is lent to loses it. Nothing is undeployed: the machine keeps running whatever it runs. A cloudflare credential is not revoked at Cloudflare. This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }),
      handler: async (estate, refresh) => {
        await client.adminDeleteEstate({ params: { id: estate.id } });
        refresh();
      },
      success: (estate) => `Deleted "${estate.slug}"`,
    },
    [client],
  );

  return (
    <AdminPage>
      <AlephaTable<AdminEstateResource>
        className="min-h-0 flex-1"
        persistenceKey="lore.admin.estates"
        fetch={fetcher}
        filters={{
          schema: filtersSchema,
          render: (form) => (
            <div className="w-72">
              <Control
                input={form.input.search}
                label=""
                icon={Search}
                placeholder="Search estates…"
                inputProps={{ "aria-label": "Search estates by slug" }}
              />
            </div>
          ),
        }}
        rowActions={(estate) => [
          {
            label: "Delete estate",
            icon: Trash2,
            destructive: true,
            onClick: (
              _estate: AdminEstateResource,
              { refresh }: { refresh: () => void },
            ) => deleteEstate.run(estate, refresh),
          },
        ]}
        columns={{
          slug: {
            label: "Slug",
            sortable: true,
            cell: (estate) => (
              <span className="flex items-center gap-2">
                <span className="font-medium">{estate.slug}</span>
                {estate.label && (
                  <span className="text-muted-foreground text-xs">
                    {estate.label}
                  </span>
                )}
              </span>
            ),
          },
          type: {
            label: "Type",
            cell: (estate) => <Badge variant="outline">{estate.type}</Badge>,
          },
          ownerUserId: {
            label: "Owner",
            /*
             * A real `<a href>` rather than a click handler, so the row keeps
             * cmd-click and "copy link address", like the projects table.
             */
            cell: (estate) => (
              <Link
                href={`/admin/users/${estate.ownerUserId}`}
                className="hover:text-foreground underline-offset-4 hover:underline"
              >
                {estate.ownerName ?? (
                  <code className="text-muted-foreground text-xs">
                    {estate.ownerUserId.slice(0, 8)}
                  </code>
                )}
              </Link>
            ),
          },
          online: {
            label: "State",
            cell: (estate) => (
              <span className="flex items-center gap-1">
                <Badge variant={estate.online ? "default" : "outline"}>
                  {estate.online ? "online" : "offline"}
                </Badge>
                <Badge variant="secondary">
                  {estate.deployAllowed ? "deploys" : "stats only"}
                </Badge>
              </span>
            ),
          },
          projectCount: {
            label: "Lent to",
            cell: (estate) => (
              <span className="tabular-nums">{estate.projectCount}</span>
            ),
          },
          lastSeenAt: {
            label: "Last seen",
            cell: (estate) => (
              <span className="text-muted-foreground text-xs">
                {estate.lastSeenAt
                  ? String(l(estate.lastSeenAt, { date: "lll" }))
                  : "never"}
              </span>
            ),
          },
          createdAt: {
            label: "Created",
            sortable: true,
            cell: (estate) => (
              <span className="text-muted-foreground text-xs">
                {String(l(estate.createdAt, { date: "ll" }))}
              </span>
            ),
          },
        }}
      />
    </AdminPage>
  );
};

export default AdminEstates;
