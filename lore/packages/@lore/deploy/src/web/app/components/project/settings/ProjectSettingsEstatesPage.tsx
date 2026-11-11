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
  LentEstateResource,
  ProjectEstateController,
} from "../../../../../api/controllers/ProjectEstateController.ts";
import type { OwnedEstateResource } from "../../../../../api/schemas/ownedEstateResourceSchema.ts";
import EstateDrawer from "../../estates/EstateDrawer.tsx";
import type { ProjectEstateTableRow } from "./projectEstateTableRow.ts";
import ProjectSettingsEstateNameCell from "./ProjectSettingsEstateNameCell.tsx";
import ProjectSettingsEstatesAddDialog from "./ProjectSettingsEstatesAddDialog.tsx";
import ProjectSettingsEstateStatusCell from "./ProjectSettingsEstateStatusCell.tsx";

/**
 * The project's estates (#E126): the ones it is the home of, which its
 * members manage by rank, and the ones it borrows, which it may only deploy
 * onto. Since estates left the account this is THE estates list: a `bay`
 * row opens its console under this project, a `cloudflare` row its drawer.
 *
 * One `DataTable` since #Q3409, where it used to be three stacked card lists
 * (add, home, borrowed). Where an estate comes from is the Origin column and
 * its filter, and "Add an estate" is the table's toolbar action. A home
 * estate reads "This project", never "Lent to this project": that its home
 * also lends it to itself is plumbing, shown only when it is NOT the case,
 * since the project then cannot deploy onto it.
 *
 * "Add" lends one of the estates the caller can see here (or mints a new one,
 * homed and lent here in the same step), and "detach" withdraws a loan. Both need `estate:lend`
 * server-side; the button is disabled here for a rank without it, with a
 * tooltip, a UX hint rather than a second authorization boundary.
 *
 * Detaching is offered to a rank with `estate:lend` and to the estate's own
 * owner, because both are legitimate: one gives up a capability, the other
 * withdraws a loan. Neither undeploys anything, and the confirmation says so,
 * since the intuitive reading is the opposite.
 */
const ProjectSettingsEstatesPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const dialog = useDialog();
  const api = useClient<ProjectEstateController>();
  const [project] = useStore(currentProjectAtom);
  const canLend = can("estate:lend");

  const [items, setItems] = useState<LentEstateResource[] | undefined>();
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
        api.listProjectEstates({
          params: { projectId: project?.id as number },
        }),
      onSuccess: (res) => setItems(res.items),
    },
    [api, project?.id],
  );

  // The estates this project is the home of (#E126), lent here or not: the
  // ones its members manage. The list above it is what it may deploy onto.
  const home = useQuery(
    {
      enabled: project !== undefined,
      key: ["project-home-estates", project?.id],
      handler: () =>
        api.listHomeEstates({ params: { projectId: project?.id as number } }),
    },
    [api, project?.id],
  );
  const homeItems = home.data?.items;
  // Resolved from the list rather than held as its own copy, so a switch
  // saved in the drawer redraws it from the same row the list shows.
  const open = (homeItems ?? []).find((item) => item.id === openId);
  const loans = new Map((items ?? []).map((item) => [item.id, item]));
  // Home estates first, then the borrowed ones, as one list. `undefined`
  // until both reads land, so the table shows its skeleton, not "empty".
  const rows: ProjectEstateTableRow[] | undefined =
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

  const lendAction = useAction<[estate: OwnedEstateResource], void>(
    {
      handler: async (_ctx, estate) => {
        if (!project) return;
        const lent = await api.attachEstate({
          params: { projectId: project.id },
          body: { estateId: estate.id },
        });
        setItems((current) => [lent, ...(current ?? [])]);
        await home.refetch();
        toaster.success(tr("estates.toast.attached"));
      },
    },
    [api, project, home, toaster, tr],
  );

  const detachAction = useAction<[estate: LentEstateResource], void>(
    {
      handler: async (_ctx, estate) => {
        if (!project) return;
        const ok = await dialog.confirm({
          title: tr("estates.detach.confirmTitle", { args: [estate.slug] }),
          description: tr("estates.detach.confirmDescription"),
          confirmLabel: tr("estates.detach.confirm"),
          destructive: true,
        });
        if (!ok) return;
        await api.detachEstate({
          params: { projectId: project.id, estateId: estate.id },
        });
        setItems((current) =>
          (current ?? []).filter((item) => item.id !== estate.id),
        );
        toaster.success(tr("estates.toast.detached"));
      },
    },
    [api, project, dialog, toaster, tr],
  );

  if (!project) return null;

  const busy = lendAction.loading || detachAction.loading;

  const rowActions = (
    row: ProjectEstateTableRow,
  ): RowActionEntry<ProjectEstateTableRow>[] => {
    const actions: RowActionEntry<ProjectEstateTableRow>[] = [];
    if (row.origin === "home" && !row.loan && canLend && row.owned) {
      const owned = row.owned;
      actions.push({
        icon: Link2,
        label: tr("estates.home.lend"),
        disabled: () => busy,
        onClick: () => void lendAction.run(owned),
      });
    }
    // Either side of the loan may end it: `estate:lend` here, or in the
    // estate's home project, which the server sends in `can`.
    if (
      row.origin === "lent" &&
      row.loan &&
      (canLend || row.loan.can.includes("estate:lend"))
    ) {
      const loan = row.loan;
      actions.push({
        icon: Unlink,
        label: tr("estates.detach.action"),
        destructive: true,
        disabled: () => busy,
        onClick: () => void detachAction.run(loan),
      });
    }
    return actions;
  };

  // Where the estate comes from, the flag the old page drew as two lists.
  // On the bar from the start, and on the Origin column's header.
  const filterFields = {
    origin: {
      schema: z.enum(["home", "lent"]),
      label: tr("estates.table.origin"),
      icon: Flag,
      mode: "default",
      column: "origin",
      optionLabel: (origin: "home" | "lent") =>
        origin === "home"
          ? tr("estates.origin.home")
          : tr("estates.origin.lent"),
      control: { clearLabel: tr("estates.origin.all") },
    },
  } satisfies DataTableFilterFields;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {freshSecret && (
        <TokenReveal
          token={freshSecret}
          title={tr("estates.secret.title")}
          copyLabel={tr("estates.secret.copy")}
          doneLabel={tr("estates.secret.done")}
          copiedMessage={tr("estates.toast.copied")}
          onDismiss={() => setFreshSecret(undefined)}
        />
      )}

      {/* Drawn once both reads land: a static table handed `[]` would say
          "no estate" for the moment it takes them to answer. */}
      {rows !== undefined && (
        <DataTable<ProjectEstateTableRow, typeof filterFields>
          className="min-h-0 flex-1"
          data={rows}
          rowKey={(row) => row.id}
          defaultSize={100}
          // Disabled rather than hidden for a rank without `estate:lend`: the
          // server refuses it anyway, and a missing button would leave them
          // wondering how an estate gets here.
          actions={[
            {
              icon: Plus,
              label: tr("estates.project.add"),
              primary: true,
              disabled: !canLend,
              onClick: () => setAdding(true),
            },
          ]}
          filters={{ fields: filterFields }}
          emptyState={{
            icon: Server,
            title: tr("estates.project.empty"),
            description: canLend ? undefined : tr("estates.project.notAllowed"),
          }}
          rowActions={rowActions}
          columns={{
            slug: {
              label: tr("estates.table.estate"),
              sortable: true,
              cell: (row) => (
                <ProjectSettingsEstateNameCell
                  row={row}
                  onOpen={(item) => setOpenId(item.id)}
                />
              ),
            },
            origin: {
              label: tr("estates.table.origin"),
              sortable: true,
              cell: (row) =>
                row.origin === "home" ? (
                  <Badge variant="secondary" data-testid="estate-origin">
                    {tr("estates.origin.home")}
                  </Badge>
                ) : (
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" data-testid="estate-origin">
                      {tr("estates.origin.lent")}
                    </Badge>
                    <span className="text-muted-foreground truncate text-xs">
                      {tr("estates.project.lentBy", {
                        args: [
                          row.loan?.home?.title ?? tr("estates.project.noHome"),
                        ],
                      })}
                    </span>
                  </span>
                ),
            },
            status: {
              label: tr("estates.table.status"),
              cell: (row) => <ProjectSettingsEstateStatusCell row={row} />,
            },
            deploys: {
              label: tr("estates.table.deploys"),
              cell: (row) => {
                // A home estate its home does not lend to itself cannot take a
                // deploy from here: the one case the lending is worth naming.
                if (row.origin === "home" && !row.loan) {
                  return (
                    <span className="text-muted-foreground text-xs">
                      {tr("estates.home.notLentHere")}
                    </span>
                  );
                }
                const estate = row.loan ?? row.owned;
                return (
                  <span className="text-muted-foreground text-xs">
                    {estate?.deployAllowed
                      ? tr("estates.deploys.allowed")
                      : tr("estates.deploys.statsOnly")}
                  </span>
                );
              },
            },
            lastSeenAt: {
              label: tr("estates.table.lastSeen"),
              sortable: true,
              sortValue: (row) => (row.owned ?? row.loan)?.lastSeenAt ?? "",
              cell: (row) => {
                const estate = row.owned ?? row.loan;
                if (estate?.type === "cloudflare") return null;
                return estate?.lastSeenAt ? (
                  <TimeAgo
                    value={estate.lastSeenAt}
                    className="text-muted-foreground text-xs"
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {tr("estates.neverSeen")}
                  </span>
                );
              },
            },
          }}
        />
      )}

      <EstateDrawer
        estate={open}
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

      <ProjectSettingsEstatesAddDialog
        open={adding}
        onOpenChange={setAdding}
        held={items ?? []}
        onAttached={(estate, secret) => {
          setItems((current) => [estate, ...(current ?? [])]);
          // A new estate is created here, its home: the group above shows it.
          void home.refetch();
          if (secret) setFreshSecret(secret);
        }}
      />
    </div>
  );
};

export default ProjectSettingsEstatesPage;
