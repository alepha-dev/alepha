import {
  Button,
  Card,
  CardContent,
  Switch,
  TimeAgo,
  useDialog,
  useToast,
} from "@alepha/ui";
import { AccountPage } from "@alepha/ui/account";
import { DataTable } from "@alepha/ui/table";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { FolderKanban, RefreshCw, Trash2, Unlink } from "lucide-react";
import { useState } from "react";

import type { EstateController } from "@/api/controllers/EstateController.ts";
import type { ProjectEstateController } from "@/api/controllers/ProjectEstateController.ts";
import type { EstateLoan } from "@/api/schemas/ownedEstateResourceSchema.ts";
import { currentEstateAtom } from "@/web/app/atoms/currentEstateAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import type { AppRouter } from "../../AppRouter.ts";
import MyEstateSecretDialog from "../account/MyEstateSecretDialog.tsx";

/**
 * The switches, the lending and the credential, for one machine.
 *
 * This is `MyEstateDrawer`'s body for a `bay` estate, on a page of its own.
 * The wording moves verbatim rather than being rewritten, because two
 * sentences here are load-bearing and were written to prevent a specific
 * misunderstanding.
 *
 * ⚠️ **A drawer is not a permission boundary, and neither is a page.** Every
 * action here is enforced server-side on the row's owner, and
 * `EstateService.loadOwned` answers 404 for anyone else. Moving the UI changes
 * what is drawn and nothing else; do not let the move quietly become a
 * permission change.
 *
 * ⚠️ **The delete dialog says what deleting does NOT do**, because the
 * intuitive reading is the opposite: nothing is undeployed, the machine keeps
 * serving, and Lore only loses the ability to inspect, redeploy or roll back.
 * Losing that sentence would be a data-loss-shaped bug in the reader's head.
 *
 * ⚠️ **Rotate is the revoke path**, and it takes the machine off the air until
 * `bay connector set` is run again over ssh with the new secret. That is a
 * manual step on another computer, so it is said before the click.
 *
 * The interval stays a short list of offered values rather than a free field:
 * it reaches the machine in its `welcome` frame, and an arbitrary number is a
 * choice nobody needs to make by hand.
 */
const BaySettings = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const router = useRouter<AppRouter>();
  const api = useClient<EstateController>();
  const projectEstateApi = useClient<ProjectEstateController>();
  const [estate, setEstate] = useStore(currentEstateAtom);
  const [freshSecret, setFreshSecret] = useState<string | undefined>();

  // One `useAction` per write, the way `MyEstateDrawer` sends the same four
  // (#E59, #Q2329). A refusal is not caught here: the root
  // `ActionErrorToaster` shows the server's message.
  const updateAction = useAction<
    [
      body: {
        deployAllowed?: boolean;
        collectSeries?: boolean;
        statsIntervalSeconds?: number;
      },
    ],
    void
  >(
    {
      handler: async (body) => {
        if (!estate) return;
        // The row is re-read from the server's answer rather than assumed, so
        // a switch that was refused does not stay flipped on screen.
        const updated = await api.updateEstate({
          params: { estateId: estate.id },
          body,
        });
        // The loans are not on the update's answer, and they did not change.
        setEstate({ ...updated, projects: estate.projects });
      },
    },
    [api, estate],
  );

  const rotateAction = useAction<[], void>(
    {
      handler: async () => {
        if (!estate) return;
        const ok = await dialog.confirm({
          title: tr("account.estates.rotate.confirmTitle", {
            args: [estate.slug],
          }),
          description: tr("account.estates.rotate.confirmDescription"),
          confirmLabel: tr("account.estates.rotate.confirm"),
          destructive: true,
        });
        if (!ok) return;
        const minted = await api.rotateEstate({
          params: { estateId: estate.id },
        });
        const { secret, ...rotated } = minted;
        setEstate({ ...rotated, projects: estate.projects });
        setFreshSecret(secret);
        toaster.success(tr("account.estates.toast.rotated"));
      },
    },
    [api, estate, dialog, toaster, tr],
  );

  const removeAction = useAction<[], void>(
    {
      handler: async () => {
        if (!estate) return;
        const ok = await dialog.confirm({
          title: tr("account.estates.delete.confirmTitle", {
            args: [estate.slug],
          }),
          description: tr("account.estates.delete.confirmDescription"),
          confirmLabel: tr("account.estates.delete.confirm"),
          destructive: true,
        });
        if (!ok) return;
        await api.deleteEstate({ params: { estateId: estate.id } });
        toaster.success(tr("account.estates.toast.deleted"));
        // The estate this console is about no longer exists, so the console
        // cannot stay open over it.
        await router.push("accountEstates");
      },
    },
    [api, estate, dialog, router, toaster, tr],
  );

  const detachAction = useAction<[loan: { id: number; title: string }], void>(
    {
      handler: async (loan) => {
        if (!estate) return;
        const ok = await dialog.confirm({
          title: tr("account.estates.detach.confirmTitle", {
            args: [estate.slug, loan.title],
          }),
          description: tr("estates.detach.confirmDescription"),
          confirmLabel: tr("estates.detach.confirm"),
          destructive: true,
        });
        if (!ok) return;
        await projectEstateApi.detachEstate({
          params: { projectId: loan.id, estateId: estate.id },
        });
        toaster.success(tr("estates.toast.detached"));
        // The loans live on the owned-list resource, which this page does not
        // hold; the list is where they are read, so it is re-read there.
        await router.push("accountEstates");
      },
    },
    [projectEstateApi, estate, dialog, router, toaster, tr],
  );

  // Page-wide: every control waits while any write runs, since `run()` drops
  // a call made while its own is in flight.
  const busy =
    updateAction.loading ||
    rotateAction.loading ||
    removeAction.loading ||
    detachAction.loading;

  if (!estate) {
    return null;
  }

  const update = updateAction.run;
  const rotate = rotateAction.run;
  const remove = removeAction.run;
  const detach = detachAction.run;

  return (
    <AccountPage variant="form" className="gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="flex flex-col gap-0.5">
              <span>{tr("account.estates.switch.deploys")}</span>
              <span className="text-muted-foreground text-xs">
                {tr("account.estates.switch.deploys.description")}
              </span>
            </span>
            <Switch
              checked={estate.deployAllowed}
              disabled={busy}
              onCheckedChange={(value) => void update({ deployAllowed: value })}
              aria-label={tr("account.estates.switch.deploys")}
              data-testid="bay-settings-deploys"
            />
          </div>

          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="flex flex-col gap-0.5">
              <span>{tr("account.estates.switch.series")}</span>
              <span className="text-muted-foreground text-xs">
                {tr("account.estates.switch.series.description")}
              </span>
            </span>
            <Switch
              checked={estate.collectSeries}
              disabled={busy}
              onCheckedChange={(value) => void update({ collectSeries: value })}
              aria-label={tr("account.estates.switch.series")}
              data-testid="bay-settings-series"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex flex-col gap-0.5">
              <span>{tr("account.estates.interval")}</span>
              <span className="text-muted-foreground text-xs">
                {tr("account.estates.interval.description")}
              </span>
            </span>
            <div className="flex flex-wrap gap-1" role="group">
              {INTERVALS.map((seconds) => (
                <Button
                  key={seconds}
                  type="button"
                  size="sm"
                  variant={
                    estate.statsIntervalSeconds === seconds
                      ? "solid"
                      : "outlined"
                  }
                  disabled={busy}
                  aria-pressed={estate.statsIntervalSeconds === seconds}
                  onClick={() => {
                    if (estate.statsIntervalSeconds !== seconds) {
                      void update({ statsIntervalSeconds: seconds });
                    }
                  }}
                >
                  {seconds < 3600
                    ? tr("account.estates.interval.minutes", {
                        args: [String(seconds / 60)],
                      })
                    : tr("account.estates.interval.hours", {
                        args: [String(seconds / 3600)],
                      })}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/*
        The projects this estate is lent to (#E68). A table rather than rows in
        a card: the list grows with every project that borrows the machine,
        and each row carries the one verb that ends the loan.
      */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          {tr("account.estates.loans.label")}
        </span>
        <DataTable<EstateLoan>
          data={estate.projects}
          rowKey={(loan) => String(loan.id)}
          // A short list inside a column of cards: no column picker, no
          // refresh (the rows come with the estate), no page-size picker.
          hideColumnPicker
          hideActionsMenu
          pageSizes={[]}
          emptyState={{
            icon: FolderKanban,
            title: tr("account.estates.loans.none"),
          }}
          columns={{
            title: {
              label: tr("bay.settings.loans.col.project"),
              sortable: true,
              cell: (loan) => (
                <span data-testid="bay-settings-loan">
                  {loan.slug ? (
                    <Link
                      href={router.path("projectSettingsEstates", {
                        params: { projectSlug: loan.slug },
                      })}
                      className="truncate underline-offset-4 hover:underline"
                    >
                      {loan.title}
                    </Link>
                  ) : (
                    <span className="truncate">{loan.title}</span>
                  )}
                </span>
              ),
            },
            lentAt: {
              label: tr("bay.settings.loans.col.lentAt"),
              sortable: true,
              cell: (loan) => (
                <TimeAgo
                  value={loan.lentAt}
                  className="text-muted-foreground text-xs"
                />
              ),
            },
          }}
          rowActions={(loan) => [
            {
              label: tr("estates.detach.action"),
              icon: Unlink,
              destructive: true,
              disabled: () => busy,
              onClick: () => void detach(loan),
            },
          ]}
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            {tr("bay.settings.rotate.warning")}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outlined"
              size="sm"
              disabled={busy}
              onClick={() => void rotate()}
              data-testid="bay-settings-rotate"
            >
              <RefreshCw className="size-4" />
              {tr("account.estates.rotate")}
            </Button>
            <Button
              variant="outlined"
              intent="danger"
              size="sm"
              disabled={busy}
              onClick={() => void remove()}
              data-testid="bay-settings-delete"
            >
              <Trash2 className="size-4" />
              {tr("account.estates.delete")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <MyEstateSecretDialog
        secret={freshSecret}
        onDismiss={() => setFreshSecret(undefined)}
      />
    </AccountPage>
  );
};

export default BaySettings;

/**
 * The stats intervals offered, in seconds. A short list rather than a free
 * field: the value reaches the machine in its `welcome` frame and an arbitrary
 * number there is a choice nobody needs to make by hand.
 */
const INTERVALS = [300, 900, 1800, 3600, 21_600, 86_400];
