import { Badge, TimeAgo, useDialog, useToast } from "@alepha/ui";
import {
  DataTable,
  type DataTableFilterFields,
  type RowActionEntry,
} from "@alepha/ui/table";
import {
  currentProjectAtom,
  useRank,
  type I18n,
  TokenReveal,
} from "@lore/core/web";
import { z } from "alepha";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Flag, Link2, Plus, Server, Unlink } from "lucide-react";
import { useState } from "react";

import type {
  LentHostResource,
  ProjectHostController,
} from "../../../../../api/controllers/ProjectHostController.ts";
import type { OwnedHostResource } from "../../../../../api/schemas/ownedHostResourceSchema.ts";
import HostDrawer from "../../hosts/HostDrawer.tsx";
import type { ProjectHostTableRow } from "./projectHostTableRow.ts";
import ProjectSettingsHostNameCell from "./ProjectSettingsHostNameCell.tsx";
import ProjectSettingsHostsAddDialog from "./ProjectSettingsHostsAddDialog.tsx";
import ProjectSettingsHostStatusCell from "./ProjectSettingsHostStatusCell.tsx";

/**
 * The project's hosts (#E126): the ones it is the home of, which its
 * members manage by rank, and the ones it borrows, which it may only deploy
 * onto. Since hosts left the account this is THE hosts list: a `bay`
 * row opens its console under this project, a `cloudflare` row its drawer.
 *
 * One `DataTable` since #Q3409, where it used to be three stacked card lists
 * (add, home, borrowed). Where a host comes from is the Origin column and
 * its filter, and "Add a host" is the table's toolbar action. A home
 * host reads "This project", never "Lent to this project": that its home
 * also lends it to itself is plumbing, shown only when it is NOT the case,
 * since the project then cannot deploy onto it.
 *
 * "Add" lends one of the hosts the caller can see here (or mints a new one,
 * homed and lent here in the same step), and "detach" withdraws a loan. Both need `host:lend`
 * server-side; the button is disabled here for a rank without it, with a
 * tooltip, a UX hint rather than a second authorization boundary.
 *
 * Detaching is offered to a rank with `host:lend` and to the host's own
 * owner, because both are legitimate: one gives up a capability, the other
 * withdraws a loan. Neither undeploys anything, and the confirmation says so,
 * since the intuitive reading is the opposite.
 */
const ProjectSettingsHostsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const dialog = useDialog();
  const api = useClient<ProjectHostController>();
  const [project] = useStore(currentProjectAtom);
  const canLend = can("host:lend");

  const [items, setItems] = useState<LentHostResource[] | undefined>();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | undefined>();
  /**
   * The one moment a freshly minted secret is readable. Cleared as soon as
   * it is dismissed; nothing can show it again.
   */
  const [freshSecret, setFreshSecret] = useState<string | undefined>();

  // Local state seeded by the read, because attaching and detaching patch
  // the list in place. A failed read is toasted by the root listener.
  useQuery(
    {
      enabled: project !== undefined,
      handler: () =>
        api.listProjectHosts({
          params: { projectId: project?.id as number },
        }),
      onSuccess: (res) => setItems(res.items),
    },
    [api, project?.id],
  );

  // The hosts this project is the home of (#E126), lent here or not: the
  // ones its members manage. The list above it is what it may deploy onto.
  const home = useQuery(
    {
      enabled: project !== undefined,
      key: ["project-home-hosts", project?.id],
      handler: () =>
        api.listHomeHosts({ params: { projectId: project?.id as number } }),
    },
    [api, project?.id],
  );
  const homeItems = home.data?.items;
  // Resolved from the list rather than held as its own copy, so a switch
  // saved in the drawer redraws it from the same row the list shows.
  const open = (homeItems ?? []).find((item) => item.id === openId);
  const loans = new Map((items ?? []).map((item) => [item.id, item]));
  // Home hosts first, then the borrowed ones, as one list. `undefined`
  // until both reads land, so the table shows its skeleton, not "empty".
  const rows: ProjectHostTableRow[] | undefined =
    items === undefined || homeItems === undefined
      ? undefined
      : [
          ...homeItems.map((owned) => ({
            id: owned.id,
            slug: owned.slug,
            origin: "home" as const,
            owned,
            loan: loans.get(owned.id),
          })),
          ...items
            .filter((loan) => !loan.isHome)
            .map((loan) => ({
              id: loan.id,
              slug: loan.slug,
              origin: "lent" as const,
              loan,
            })),
        ];

  const lendAction = useAction<[host: OwnedHostResource], void>(
    {
      handler: async (_ctx, host) => {
        if (!project) return;
        const lent = await api.attachHost({
          params: { projectId: project.id },
          body: { hostId: host.id },
        });
        setItems((current) => [lent, ...(current ?? [])]);
        await home.refetch();
        toaster.success(tr("hosts.toast.attached"));
      },
    },
    [api, project, home, toaster, tr],
  );

  const detachAction = useAction<[host: LentHostResource], void>(
    {
      handler: async (_ctx, host) => {
        if (!project) return;
        const ok = await dialog.confirm({
          title: tr("hosts.detach.confirmTitle", { args: [host.slug] }),
          description: tr("hosts.detach.confirmDescription"),
          confirmLabel: tr("hosts.detach.confirm"),
          destructive: true,
        });
        if (!ok) return;
        await api.detachHost({
          params: { projectId: project.id, hostId: host.id },
        });
        setItems((current) =>
          (current ?? []).filter((item) => item.id !== host.id),
        );
        toaster.success(tr("hosts.toast.detached"));
      },
    },
    [api, project, dialog, toaster, tr],
  );

  if (!project) return null;

  const busy = lendAction.loading || detachAction.loading;

  const rowActions = (
    row: ProjectHostTableRow,
  ): RowActionEntry<ProjectHostTableRow>[] => {
    const actions: RowActionEntry<ProjectHostTableRow>[] = [];
    if (row.origin === "home" && !row.loan && canLend && row.owned) {
      const owned = row.owned;
      actions.push({
        icon: Link2,
        label: tr("hosts.home.lend"),
        disabled: () => busy,
        onClick: () => void lendAction.run(owned),
      });
    }
    // Either side of the loan may end it: `host:lend` here, or in the
    // host's home project, which the server sends in `can`.
    if (
      row.origin === "lent" &&
      row.loan &&
      (canLend || row.loan.can.includes("host:lend"))
    ) {
      const loan = row.loan;
      actions.push({
        icon: Unlink,
        label: tr("hosts.detach.action"),
        destructive: true,
        disabled: () => busy,
        onClick: () => void detachAction.run(loan),
      });
    }
    return actions;
  };

  // Where the host comes from, the flag the old page drew as two lists.
  // On the bar from the start, and on the Origin column's header.
  const filterFields = {
    origin: {
      schema: z.enum(["home", "lent"]),
      label: tr("hosts.table.origin"),
      icon: Flag,
      mode: "default",
      column: "origin",
      optionLabel: (origin: "home" | "lent") =>
        origin === "home" ? tr("hosts.origin.home") : tr("hosts.origin.lent"),
      control: { clearLabel: tr("hosts.origin.all") },
    },
  } satisfies DataTableFilterFields;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {freshSecret && (
        <TokenReveal
          token={freshSecret}
          title={tr("hosts.secret.title")}
          copyLabel={tr("hosts.secret.copy")}
          doneLabel={tr("hosts.secret.done")}
          copiedMessage={tr("hosts.toast.copied")}
          onDismiss={() => setFreshSecret(undefined)}
        />
      )}

      {/* Drawn once both reads land: a static table handed `[]` would say
          "no host" for the moment it takes them to answer. */}
      {rows !== undefined && (
        <DataTable<ProjectHostTableRow, typeof filterFields>
          className="min-h-0 flex-1"
          data={rows}
          rowKey={(row) => row.id}
          defaultSize={100}
          // Disabled rather than hidden for a rank without `host:lend`: the
          // server refuses it anyway, and a missing button would leave them
          // wondering how a host gets here.
          actions={[
            {
              icon: Plus,
              label: tr("hosts.project.add"),
              primary: true,
              disabled: !canLend,
              onClick: () => setAdding(true),
            },
          ]}
          filters={{ fields: filterFields }}
          emptyState={{
            icon: Server,
            title: tr("hosts.project.empty"),
            description: canLend ? undefined : tr("hosts.project.notAllowed"),
          }}
          rowActions={rowActions}
          columns={{
            slug: {
              label: tr("hosts.table.host"),
              sortable: true,
              cell: (row) => (
                <ProjectSettingsHostNameCell
                  row={row}
                  onOpen={(item) => setOpenId(item.id)}
                />
              ),
            },
            origin: {
              label: tr("hosts.table.origin"),
              sortable: true,
              cell: (row) =>
                row.origin === "home" ? (
                  <Badge variant="secondary" data-testid="host-origin">
                    {tr("hosts.origin.home")}
                  </Badge>
                ) : (
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" data-testid="host-origin">
                      {tr("hosts.origin.lent")}
                    </Badge>
                    <span className="text-muted-foreground truncate text-xs">
                      {tr("hosts.project.lentBy", {
                        args: [
                          row.loan?.home?.title ?? tr("hosts.project.noHome"),
                        ],
                      })}
                    </span>
                  </span>
                ),
            },
            status: {
              label: tr("hosts.table.status"),
              cell: (row) => <ProjectSettingsHostStatusCell row={row} />,
            },
            deploys: {
              label: tr("hosts.table.deploys"),
              cell: (row) => {
                // A home host its home does not lend to itself cannot take a
                // deploy from here: the one case the lending is worth naming.
                if (row.origin === "home" && !row.loan) {
                  return (
                    <span className="text-muted-foreground text-xs">
                      {tr("hosts.home.notLentHere")}
                    </span>
                  );
                }
                const host = row.loan ?? row.owned;
                return (
                  <span className="text-muted-foreground text-xs">
                    {host?.deployAllowed
                      ? tr("hosts.deploys.allowed")
                      : tr("hosts.deploys.statsOnly")}
                  </span>
                );
              },
            },
            lastSeenAt: {
              label: tr("hosts.table.lastSeen"),
              sortable: true,
              sortValue: (row) => (row.owned ?? row.loan)?.lastSeenAt ?? "",
              cell: (row) => {
                const host = row.owned ?? row.loan;
                if (host?.type === "cloudflare") return null;
                return host?.lastSeenAt ? (
                  <TimeAgo
                    value={host.lastSeenAt}
                    className="text-muted-foreground text-xs"
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {tr("hosts.neverSeen")}
                  </span>
                );
              },
            },
          }}
        />
      )}

      <HostDrawer
        host={open}
        onOpenChange={(next) => {
          if (!next) setOpenId(undefined);
        }}
        // The rows are the query's, so a write re-reads them rather than
        // patching a copy; the borrowed list is untouched by these writes.
        onChanged={() => void home.refetch()}
        onDeleted={(id) => {
          setOpenId(undefined);
          setItems((current) =>
            (current ?? []).filter((item) => item.id !== id),
          );
          void home.refetch();
        }}
        onSecret={setFreshSecret}
      />

      <ProjectSettingsHostsAddDialog
        open={adding}
        onOpenChange={setAdding}
        held={items ?? []}
        onAttached={(host, secret) => {
          setItems((current) => [host, ...(current ?? [])]);
          // A new host is created here, its home: the group above shows it.
          void home.refetch();
          if (secret) setFreshSecret(secret);
        }}
      />
    </div>
  );
};

export default ProjectSettingsHostsPage;
