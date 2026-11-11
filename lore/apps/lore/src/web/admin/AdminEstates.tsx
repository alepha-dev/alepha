import { Badge } from "@alepha/ui";
import { AdminPage, useConfirmedAction } from "@alepha/ui/admin";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import type { AdminEstateController } from "@lore/deploy/api";
import type { AdminEstateResource } from "@lore/deploy/schemas";
import { z } from "alepha";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { FolderInput, Home, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import AdminEstateAssignDialog from "./AdminEstateAssignDialog.tsx";

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
export const AdminEstates = () => {
  const client = useClient<AdminEstateController>();
  const { l } = useI18n();

  // Literal English, like the rest of the Lore admin: it is untranslated.
  const filterFields = {
    search: {
      preset: "search",
      placeholder: "Search estates…",
      control: { inputProps: { "aria-label": "Search estates by slug" } },
    },
    // The estates the migration could not place (#E126): the ones to assign.
    home: {
      schema: z.array(z.string()),
      label: "Home",
      icon: Home,
      items: [{ value: "none", label: "No home" }],
      control: { clearLabel: "Any home" },
    },
  } satisfies DataTableFilterFields;
  const [assigning, setAssigning] = useState<AdminEstateResource>();
  const refreshRef = useRef<() => void>(() => {});

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: DataTableFilterValues<typeof filterFields>;
    }) => {
      return client.findEstates({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          search: params.filters?.search || undefined,
          ...(params.filters?.home?.includes("none") ? { homeless: true } : {}),
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
      <DataTable<AdminEstateResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey="lore.admin.estates"
        fetch={fetcher}
        filters={{ fields: filterFields }}
        rowActions={(estate) => [
          {
            label: "Assign to project",
            icon: FolderInput,
            onClick: (
              _estate: AdminEstateResource,
              { refresh }: { refresh: () => void },
            ) => {
              refreshRef.current = refresh;
              setAssigning(estate);
            },
          },
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
          project: {
            label: "Project",
            cell: (estate) =>
              estate.project ? (
                <span>{estate.project.title}</span>
              ) : (
                <Badge variant="destructive">No home</Badge>
              ),
          },
          creator: {
            label: "Created by",
            /*
             * A real `<a href>` rather than a click handler, so the row keeps
             * cmd-click and "copy link address", like the projects table.
             */
            cell: (estate) =>
              estate.creator ? (
                <Link
                  href={`/admin/users/${estate.creator.id}`}
                  className="hover:text-foreground underline-offset-4 hover:underline"
                >
                  {estate.creator.name}
                </Link>
              ) : (
                <span className="text-muted-foreground text-xs">unknown</span>
              ),
          },
          online: {
            label: "State",
            cell: (estate) => (
              <span className="flex items-center gap-1">
                {/* A cloudflare account never connects, so `online` says
                    nothing about one. Whether its credential still works
                    does (#1630). */}
                {estate.type === "cloudflare" ? (
                  <Badge
                    variant={
                      estate.credentialStatus === "valid"
                        ? "default"
                        : "destructive"
                    }
                  >
                    {estate.credentialStatus === "valid"
                      ? "credential valid"
                      : "credential invalid"}
                  </Badge>
                ) : (
                  <Badge variant={estate.online ? "default" : "outline"}>
                    {estate.online ? "online" : "offline"}
                  </Badge>
                )}
                <Badge variant="secondary">
                  {estate.deployAllowed ? "deploys" : "stats only"}
                </Badge>
              </span>
            ),
          },
          loans: {
            label: "Lent to",
            cell: (estate) => (
              <span className="text-xs">
                {estate.loans.length
                  ? estate.loans.map((project) => project.title).join(", ")
                  : "none"}
              </span>
            ),
          },
          lastSeenAt: {
            label: "Last seen",
            cell: (estate) => (
              <span className="text-muted-foreground text-xs">
                {estate.lastSeenAt
                  ? l(estate.lastSeenAt, { date: "lll" })
                  : "never"}
              </span>
            ),
          },
          createdAt: {
            label: "Created",
            sortable: true,
            cell: (estate) => (
              <span className="text-muted-foreground text-xs">
                {l(estate.createdAt, { date: "ll" })}
              </span>
            ),
          },
        }}
      />
      <AdminEstateAssignDialog
        key={assigning?.id ?? "none"}
        estate={assigning}
        onOpenChange={(open) => {
          if (!open) setAssigning(undefined);
        }}
        onAssigned={() => refreshRef.current()}
      />
    </AdminPage>
  );
};

export default AdminEstates;
