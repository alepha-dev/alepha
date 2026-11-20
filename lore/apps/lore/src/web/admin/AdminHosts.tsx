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
  BarChart3,
  CircleDot,
  Cloud,
  FolderInput,
  KeyRound,
  Pencil,
  Rocket,
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
          // The tag pill of the quests pages (#Q3941): every tag chip is
          // `<Badge variant="tint">` in its tone (`tagTone` in @lore/plan),
          // and a type has no colour of its own, so `neutral`, as an
          // uncoloured tag is. Every pill on this page is that tag, with a
          // leading icon (#Q4010).
          type: {
            label: "Type",
            cell: (host) => {
              const Icon = host.type === "cloudflare" ? Cloud : Server;
              return (
                <Badge variant="tint" tone="neutral" data-testid="host-type">
                  <Icon className="size-3" aria-hidden="true" />
                  {host.type}
                </Badge>
              );
            },
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
            cell: (host) => {
              // Online or offline, nothing else (#Q4010). A cloudflare account
              // never connects, so `online` says nothing about one: whether
              // its credential still works does (#1630), and a valid one
              // reads online.
              const online =
                host.type === "cloudflare"
                  ? host.credentialStatus === "valid"
                  : host.online;
              return (
                <Badge
                  variant="tint"
                  tone={online ? "success" : "neutral"}
                  data-testid="host-state"
                >
                  <CircleDot className="size-3" aria-hidden="true" />
                  {online ? "online" : "offline"}
                </Badge>
              );
            },
          },
          capabilities: {
            label: "Capabilities",
            cell: (host) => {
              // What the host does, as a list so a capability to come (the
              // agent) is one more entry. Stats come from Bay's connector:
              // a cloudflare account reports none, so it carries no pill.
              const capabilities = [
                ...(host.type === "bay"
                  ? [{ label: "stats", icon: BarChart3 }]
                  : []),
                ...(host.deployAllowed
                  ? [{ label: "deploy", icon: Rocket }]
                  : []),
              ];
              return (
                <span
                  className="flex flex-wrap items-center gap-1"
                  data-testid="host-capabilities"
                >
                  {capabilities.map((capability) => (
                    <Badge key={capability.label} variant="tint" tone="neutral">
                      <capability.icon className="size-3" aria-hidden="true" />
                      {capability.label}
                    </Badge>
                  ))}
                </span>
              );
            },
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
            // A cloudflare host is an account credential: it never connects,
            // so it has no last-seen by nature, and "never" would read as a
            // fault (#Q3943). A bay host that never connected keeps it.
            cell: (host) =>
              host.type === "cloudflare" ? (
                <span
                  className="text-muted-foreground text-xs"
                  title="A Cloudflare account does not connect"
                  data-testid="host-last-seen"
                >
                  N/A
                </span>
              ) : (
                <span
                  className="text-muted-foreground text-xs"
                  data-testid="host-last-seen"
                >
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
