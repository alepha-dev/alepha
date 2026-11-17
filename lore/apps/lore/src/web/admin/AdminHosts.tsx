import { Badge, cn, textLinkUnderlineClassName } from "@alepha/ui";
import { AdminPage, useConfirmedAction } from "@alepha/ui/admin";
import {
  DataTable,
  type DataTableFilterFields,
  type DataTableFilterValues,
} from "@alepha/ui/table";
import type { AdminHostController } from "@lore/ship/api";
import type { AdminHostResource } from "@lore/ship/schemas";
import { z } from "alepha";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import {
  CircleDot,
  FolderInput,
  KeyRound,
  Pencil,
  Server,
  Trash2,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import AdminHostAssignDialog from "./AdminHostAssignDialog.tsx";
import AdminHostRenameDialog from "./AdminHostRenameDialog.tsx";

/**
 * Instance-wide hosts list, mounted into the shared admin shell by
 * `LoreAdminRouter` (#1838).
 *
 * The backstop for a host whose owner is gone or unresponsive. An admin
 * sees every host and can rename (#Q3664), assign or delete one; an admin can never read a
 * credential, and this page has no column for one. The delete confirmation
 * says what deleting does not do, for the same reason the owner's does:
 * nothing is undeployed, and a `cloudflare` credential is not revoked at
 * Cloudflare.
 */
export const AdminHosts = () => {
  const client = useClient<AdminHostController>();
  const { l } = useI18n();

  // Literal English, like the rest of the Lore admin: it is untranslated.
  const filterFields = {
    search: {
      preset: "search",
      placeholder: "Search hosts…",
      control: { inputProps: { "aria-label": "Search hosts by slug" } },
    },
    // Applied server-side by `findHosts` (#Q3800), so paging stays exact.
    type: {
      // The entity's `HOST_TYPES`, which the browser cannot import.
      schema: z.enum(["bay", "cloudflare"]),
      label: "Type",
      icon: Server,
      items: [
        { value: "bay", label: "bay" },
        { value: "cloudflare", label: "cloudflare" },
      ],
      control: { clearLabel: "All types" },
    },
    state: {
      schema: z.enum(["online", "offline"]),
      label: "State",
      icon: CircleDot,
      items: [
        { value: "online", label: "Online" },
        { value: "offline", label: "Offline" },
      ],
      control: { clearLabel: "Any state" },
    },
    credentialStatus: {
      schema: z.enum(["valid", "invalid"]),
      label: "Credential",
      icon: KeyRound,
      items: [
        { value: "valid", label: "Valid" },
        { value: "invalid", label: "Invalid" },
      ],
      control: { clearLabel: "Any credential" },
    },
  } satisfies DataTableFilterFields;
  const [assigning, setAssigning] = useState<AdminHostResource>();
  const [renaming, setRenaming] = useState<AdminHostResource>();
  const refreshRef = useRef<() => void>(() => {});

  const fetcher = useCallback(
    async (params: {
      page: number;
      size: number;
      sort?: string;
      filters?: DataTableFilterValues<typeof filterFields>;
    }) => {
      return client.findHosts({
        query: {
          page: params.page,
          size: params.size,
          sort: params.sort,
          search: params.filters?.search || undefined,
          type: params.filters?.type || undefined,
          state: params.filters?.state || undefined,
          credentialStatus: params.filters?.credentialStatus || undefined,
        },
      });
    },
    [client],
  );

  const deleteHost = useConfirmedAction<[AdminHostResource, () => void]>(
    {
      confirm: (host) => ({
        title: "Delete host",
        description: `Delete "${host.slug}"? Its secret stops working and every project it is lent to loses it. Nothing is undeployed: the machine keeps running whatever it runs. A cloudflare credential is not revoked at Cloudflare. This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }),
      handler: async (host, refresh) => {
        await client.adminDeleteHost({ params: { id: host.id } });
        refresh();
      },
      success: (host) => `Deleted "${host.slug}"`,
    },
    [client],
  );

  return (
    <AdminPage>
      <DataTable<AdminHostResource, typeof filterFields>
        className="min-h-0 flex-1"
        persistenceKey="lore.admin.hosts"
        fetch={fetcher}
        filters={{ fields: filterFields }}
        rowActions={(host) => [
          {
            // Moderation (#Q3664): fix a name without deleting the host.
            label: "Rename",
            icon: Pencil,
            onClick: (
              _host: AdminHostResource,
              { refresh }: { refresh: () => void },
            ) => {
              refreshRef.current = refresh;
              setRenaming(host);
            },
          },
          {
            label: "Assign to project",
            icon: FolderInput,
            onClick: (
              _host: AdminHostResource,
              { refresh }: { refresh: () => void },
            ) => {
              refreshRef.current = refresh;
              setAssigning(host);
            },
          },
          {
            label: "Delete host",
            icon: Trash2,
            destructive: true,
            onClick: (
              _host: AdminHostResource,
              { refresh }: { refresh: () => void },
            ) => deleteHost.run(host, refresh),
          },
        ]}
        columns={{
          slug: {
            label: "Slug",
            sortable: true,
            cell: (host) => (
              <span className="flex items-center gap-2">
                <span className="font-medium">{host.slug}</span>
                {host.label && (
                  <span className="text-muted-foreground text-xs">
                    {host.label}
                  </span>
                )}
              </span>
            ),
          },
          type: {
            label: "Type",
            cell: (host) => <Badge variant="outline">{host.type}</Badge>,
          },
          project: {
            label: "Project",
            cell: (host) =>
              // Every host has a home since #Q3627.
              host.project ? <span>{host.project.title}</span> : null,
          },
          creator: {
            label: "Created by",
            /*
             * A real `<a href>` rather than a click handler, so the row keeps
             * cmd-click and "copy link address", like the projects table.
             */
            cell: (host) =>
              host.creator ? (
                <Link
                  href={`/admin/users/${host.creator.id}`}
                  className={cn(
                    textLinkUnderlineClassName,
                    "hover:text-foreground",
                  )}
                >
                  {host.creator.name}
                </Link>
              ) : (
                <span className="text-muted-foreground text-xs">unknown</span>
              ),
          },
          online: {
            label: "State",
            cell: (host) => (
              <span className="flex items-center gap-1">
                {/* A cloudflare account never connects, so `online` says
                    nothing about one. Whether its credential still works
                    does (#1630). */}
                {host.type === "cloudflare" ? (
                  <Badge
                    variant={
                      host.credentialStatus === "valid"
                        ? "default"
                        : "destructive"
                    }
                  >
                    {host.credentialStatus === "valid"
                      ? "credential valid"
                      : "credential invalid"}
                  </Badge>
                ) : (
                  <Badge variant={host.online ? "default" : "outline"}>
                    {host.online ? "online" : "offline"}
                  </Badge>
                )}
                <Badge variant="secondary">
                  {host.deployAllowed ? "deploys" : "stats only"}
                </Badge>
              </span>
            ),
          },
          loans: {
            label: "Lent to",
            cell: (host) => (
              <span className="text-xs">
                {host.loans.length
                  ? host.loans.map((project) => project.title).join(", ")
                  : "none"}
              </span>
            ),
          },
          lastSeenAt: {
            label: "Last seen",
            cell: (host) => (
              <span className="text-muted-foreground text-xs">
                {host.lastSeenAt
                  ? l(host.lastSeenAt, { date: "lll" })
                  : "never"}
              </span>
            ),
          },
          createdAt: {
            label: "Created",
            sortable: true,
            cell: (host) => (
              <span className="text-muted-foreground text-xs">
                {l(host.createdAt, { date: "ll" })}
              </span>
            ),
          },
        }}
      />
      <AdminHostAssignDialog
        key={assigning?.id ?? "none"}
        host={assigning}
        onOpenChange={(open) => {
          if (!open) setAssigning(undefined);
        }}
        onAssigned={() => refreshRef.current()}
      />
      <AdminHostRenameDialog
        key={`rename-${renaming?.id ?? "none"}`}
        host={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(undefined);
        }}
        onRenamed={() => refreshRef.current()}
      />
    </AdminPage>
  );
};

export default AdminHosts;
