import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { RefreshCw, Trash2, Unlink } from "lucide-react";
import { useState } from "react";

import type { EstateController } from "@/api/controllers/EstateController.ts";
import type { ProjectEstateController } from "@/api/controllers/ProjectEstateController.ts";
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
  const [busy, setBusy] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | undefined>();

  if (!estate) {
    return null;
  }

  const fail = (error: unknown) =>
    toaster.error(error instanceof Error ? error.message : String(error));

  const update = async (body: {
    deployAllowed?: boolean;
    collectSeries?: boolean;
    statsIntervalSeconds?: number;
  }) => {
    setBusy(true);
    try {
      // The row is re-read from the server's answer rather than assumed, so a
      // switch that was refused does not stay flipped on screen.
      const updated = await api.updateEstate({
        params: { estateId: estate.id },
        body,
      });
      // The loans are not on the update's answer, and they did not change.
      setEstate({ ...updated, projects: estate.projects });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    const ok = await dialog.confirm({
      title: String(
        tr("account.estates.rotate.confirmTitle", { args: [estate.slug] }),
      ),
      description: String(tr("account.estates.rotate.confirmDescription")),
      confirmLabel: String(tr("account.estates.rotate.confirm")),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const minted = await api.rotateEstate({
        params: { estateId: estate.id },
      });
      const { secret, ...rotated } = minted;
      setEstate({ ...rotated, projects: estate.projects });
      setFreshSecret(secret);
      toaster.success(tr("account.estates.toast.rotated"));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await dialog.confirm({
      title: String(
        tr("account.estates.delete.confirmTitle", { args: [estate.slug] }),
      ),
      description: String(tr("account.estates.delete.confirmDescription")),
      confirmLabel: String(tr("account.estates.delete.confirm")),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteEstate({ params: { estateId: estate.id } });
      toaster.success(tr("account.estates.toast.deleted"));
      // The estate this console is about no longer exists, so the console
      // cannot stay open over it.
      await router.push("accountEstates");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const detach = async (loan: { id: number; title: string }) => {
    const ok = await dialog.confirm({
      title: String(
        tr("account.estates.detach.confirmTitle", {
          args: [estate.slug, loan.title],
        }),
      ),
      description: String(tr("estates.detach.confirmDescription")),
      confirmLabel: String(tr("estates.detach.confirm")),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await projectEstateApi.detachEstate({
        params: { projectId: loan.id, estateId: estate.id },
      });
      toaster.success(tr("estates.toast.detached"));
      // The loans live on the owned-list resource, which this page does not
      // hold; the list is where they are read, so it is re-read there.
      await router.push("accountEstates");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
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
                      ? "default"
                      : "outline"
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

      <Card>
        <CardContent className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">
            {estate.projects.length
              ? tr("account.estates.loans.label")
              : tr("account.estates.loans.none")}
          </span>
          {estate.projects.map((loan) => (
            <div
              key={loan.id}
              className="flex items-center justify-between gap-2 text-sm"
              data-testid="bay-settings-loan"
            >
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
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={tr("estates.detach.action")}
                onClick={() => void detach(loan)}
              >
                <Unlink className="size-4" />
                {tr("estates.detach.action")}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs">
            {tr("bay.settings.rotate.warning")}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void rotate()}
              data-testid="bay-settings-rotate"
            >
              <RefreshCw className="size-4" />
              {tr("account.estates.rotate")}
            </Button>
            <Button
              variant="destructive"
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
    </div>
  );
};

export default BaySettings;

/**
 * The stats intervals offered, in seconds. A short list rather than a free
 * field: the value reaches the machine in its `welcome` frame and an arbitrary
 * number there is a choice nobody needs to make by hand.
 */
const INTERVALS = [300, 900, 1800, 3600, 21_600, 86_400];
