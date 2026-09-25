import { Badge, Button, TimeAgo, useToast } from "@alepha/ui";
import { AccountPage } from "@alepha/ui/account";
import { DataTable } from "@alepha/ui/table";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Cloud, Plus, Server } from "lucide-react";
import { useState } from "react";

import type { EstateController } from "@/api/controllers/EstateController.ts";
import type { CreateEstateBody } from "@/api/schemas/createEstateBodySchema.ts";
import type { OwnedEstateResource } from "@/api/schemas/ownedEstateResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import type { AppRouter } from "../../AppRouter.ts";
import MyEstateCreateDialog from "./MyEstateCreateDialog.tsx";
import MyEstateDrawer from "./MyEstateDrawer.tsx";
import MyEstateSecretDialog from "./MyEstateSecretDialog.tsx";

/**
 * The estates the signed-in user owns, across every project (#1838).
 *
 * An estate is personal: it is created here or from inside a project, and
 * lent to projects from their settings. This page is where the owner sees
 * all of them at once, with the switches and the secret, which no project
 * page shows because neither belongs to a project.
 *
 * Every action here is also enforced server-side on the row's owner
 * (`EstateService.loadOwned` answers 404 for anyone else); the page only
 * decides what to draw.
 *
 * ## The shape, and why it changed
 *
 * A `DataTable` (#E68), a create dialog opened from its toolbar, a detail
 * drawer, and the secret in a dialog of its own - the shape `@alepha/ui`'s
 * `AccountKeys.tsx` uses, adopted here for feedback #2110 and #2109
 * together. The list is unpaginated, so the table pages it in memory.
 *
 * It was: an always-present create card, then one fully expanded card per
 * estate carrying the switches, the interval, the loans, the commands and
 * both destructive actions. Readable with one estate; unusable with three.
 *
 * ⚠️ The two reports are one change, not two. A freshly minted secret used to
 * appear in a card at the top of THIS page - a page that re-renders on every
 * switch in every estate below it. `estates.secretHash` stores a hash, so a
 * credential that scrolls out of view is gone, and the only way back is a
 * rotation that invalidates the machine already using it. Moving the reveal
 * into a dialog only works if the create form leaves the page too, or the
 * dialog opens behind the form that spawned it.
 *
 * Creation and rotation both mint, so both land in the same
 * {@link MyEstateSecretDialog}. `freshSecret` lives here rather than in the
 * drawer for that reason: the drawer is where a rotation starts, and it can
 * be closed.
 */
const MyEstates = () => {
  const { tr, l } = useI18n<I18n, "en">();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const api = useClient<EstateController>();

  const [items, setItems] = useState<OwnedEstateResource[] | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | undefined>();
  const [openId, setOpenId] = useState<string | undefined>();

  // Local state seeded by the read, because create, the drawer's writes and
  // delete patch the list in place. A failed read is toasted by the root
  // `ActionErrorToaster`.
  useQuery(
    {
      handler: () => api.listMyEstates(),
      onSuccess: (res) => setItems(res.items),
    },
    [api],
  );

  // Resolved from the list rather than held as its own copy, so a switch
  // saved in the drawer redraws it from the same row the list shows.
  const open = (items ?? []).find((item) => item.id === openId);

  /**
   * Rethrows rather than reporting: the dialog stays open and renders a
   * refusal beside the field it concerns, which a toast cannot do and which
   * is the whole point of checking the token before the row exists (#1630).
   *
   * ⚠️ A plain function, not a `useAction` run, on purpose (#E59): the create
   * dialog awaits it from its own action and needs a refusal to reject, which
   * a `run()` resolving `undefined` would not do.
   */
  const create = async (body: CreateEstateBody) => {
    const minted = await api.createEstate({ body });
    const { secret, ...estate } = minted;
    setItems((current) => [{ ...estate, projects: [] }, ...(current ?? [])]);
    setCreateOpen(false);
    // Present only when Lore minted one, so a cloudflare create leaves the
    // reveal dialog shut because the FIELD is absent, not because an empty
    // string happens to be falsy.
    if (secret) {
      setFreshSecret(secret);
    }
    toaster.success(tr("account.estates.toast.created"));
  };

  return (
    <AccountPage variant="table">
      <DataTable<OwnedEstateResource>
        className="min-h-0 flex-1"
        data={items ?? []}
        rowKey={(estate) => estate.id}
        // ⚠️ Two behaviours in one list, stated here rather than left to be
        // discovered: a `bay` row opens its console, which is where its
        // switches, apps and actions live; a `cloudflare` row keeps the
        // drawer until #E22 gives it a page of its own.
        onRowClick={(estate) =>
          estate.type === "bay"
            ? void router.push("bay", { params: { estateId: estate.id } })
            : setOpenId(estate.id)
        }
        // A labelled button in the toolbar slot rather than a `TableAction`,
        // which carries no test id: e2e and the browser spec open the dialog
        // through `estate-create-open`. "New estate" here, "Create" on the
        // dialog's submit: this opens a form, it does not perform the act.
        toolbar={
          <Button
            variant="solid"
            intent="none"
            size="sm"
            onClick={() => setCreateOpen(true)}
            data-testid="estate-create-open"
          >
            <Plus className="size-4" />
            {tr("account.estates.new")}
          </Button>
        }
        // With no estates the empty state names the act the toolbar button
        // performs, the way "Create a key" did on API keys (feedback #P2140).
        emptyState={{
          icon: Server,
          title: tr("account.estates.create"),
          description: tr("account.estates.create.description"),
        }}
        columns={{
          type: {
            label: tr("account.estates.col.kind"),
            sortable: true,
            cell: (estate) => (
              <span className="flex items-center gap-1.5 text-xs">
                {estate.type === "cloudflare" ? (
                  <Cloud className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <Server className="text-muted-foreground size-4 shrink-0" />
                )}
                {estate.type}
              </span>
            ),
          },
          /*
            The row's test id sits on this cell: the table draws the `tr`,
            and a click here bubbles to the row's own handler. The masked
            prefix names the credential; the credential itself is gone and
            cannot be shown again (`MyEstateSecretDialog`).
          */
          slug: {
            label: tr("account.estates.col.estate"),
            sortable: true,
            cell: (estate) => (
              <div
                className="flex min-w-0 flex-col gap-0.5"
                data-testid="my-estate-row"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate" data-testid="my-estate-slug">
                    {estate.slug}
                  </span>
                  {estate.label && (
                    <span className="text-muted-foreground truncate text-xs font-normal">
                      {estate.label}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {estate.secretPrefix &&
                    (estate.type === "cloudflare"
                      ? tr("account.estates.tokenPrefix", {
                          args: [estate.secretPrefix],
                        })
                      : tr("account.estates.secretPrefix", {
                          args: [estate.secretPrefix],
                        }))}
                  {estate.secretPrefix && " · "}
                  {estate.type === "cloudflare"
                    ? estate.credentialCheckedAt
                      ? tr("estates.credential.checked", {
                          args: [
                            l(estate.credentialCheckedAt, { date: "lll" }),
                          ],
                        })
                      : tr("estates.credential.neverChecked")
                    : estate.lastSeenAt
                      ? tr("estates.lastSeen", {
                          args: [l(estate.lastSeenAt, { date: "lll" })],
                        })
                      : tr("estates.neverSeen")}
                  {/* Only a `bay` estate reports an inventory. From the
                      denormalised count on the inventory row, so this costs
                      no JSON parsing and wakes no machine. Absent is
                      "nothing reported", never "0 apps". */}
                  {estate.type === "bay" && (
                    <>
                      {" · "}
                      {estate.inventory
                        ? tr("account.estates.inventory", {
                            args: [
                              String(estate.inventory.appCount),
                              l(estate.inventory.reportedAt, {
                                date: "fromNow",
                              }),
                            ],
                          })
                        : tr("account.estates.inventory.none")}
                    </>
                  )}
                </span>
              </div>
            ),
          },
          /*
            A cloudflare account never connects, so `online` is always false
            on it and says nothing. What a person needs there is whether the
            credential still works (#1630).
          */
          status: {
            label: tr("account.estates.col.status"),
            cell: (estate) => (
              <span className="flex flex-wrap items-center gap-1.5">
                {estate.type === "cloudflare" ? (
                  <Badge
                    variant={
                      estate.credentialStatus === "valid"
                        ? "default"
                        : "destructive"
                    }
                    data-testid="my-estate-credential-status"
                  >
                    {estate.credentialStatus === "valid"
                      ? tr("estates.credential.valid")
                      : tr("estates.credential.invalid")}
                  </Badge>
                ) : (
                  <Badge variant={estate.online ? "default" : "outline"}>
                    {estate.online
                      ? tr("estates.online")
                      : tr("estates.offline")}
                  </Badge>
                )}
                <Badge variant="secondary">
                  {estate.deployAllowed
                    ? tr("estates.deploys.allowed")
                    : tr("estates.deploys.statsOnly")}
                </Badge>
              </span>
            ),
          },
          projects: {
            label: tr("account.estates.col.lentTo"),
            sortable: true,
            sortValue: (estate) => estate.projects.length,
            align: "right",
            cell: (estate) => (
              <span className="text-muted-foreground text-xs tabular-nums">
                {tr("account.estates.lentTo", {
                  args: [String(estate.projects.length)],
                })}
              </span>
            ),
          },
          createdAt: {
            label: tr("account.estates.col.created"),
            sortable: true,
            cell: (estate) => (
              <TimeAgo
                value={estate.createdAt}
                className="text-muted-foreground text-xs"
              />
            ),
          },
        }}
      />

      <MyEstateCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={create}
      />

      <MyEstateDrawer
        estate={open}
        onOpenChange={(next) => {
          if (!next) setOpenId(undefined);
        }}
        onChanged={(updated) =>
          setItems((current) =>
            (current ?? []).map((item) =>
              item.id === updated.id ? updated : item,
            ),
          )
        }
        onDeleted={(id) =>
          setItems((current) =>
            (current ?? []).filter((item) => item.id !== id),
          )
        }
        onSecret={setFreshSecret}
      />

      <MyEstateSecretDialog
        secret={freshSecret}
        onDismiss={() => setFreshSecret(undefined)}
      />
    </AccountPage>
  );
};

export default MyEstates;
