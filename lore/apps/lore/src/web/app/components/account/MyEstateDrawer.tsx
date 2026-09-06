import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui/components/ui/sheet";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { RefreshCw, Trash2, Unlink } from "lucide-react";
import { useState } from "react";

import type { EstateController } from "@/api/controllers/EstateController.ts";
import type { ProjectEstateController } from "@/api/controllers/ProjectEstateController.ts";
import type { OwnedEstateResource } from "@/api/schemas/ownedEstateResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import type { AppRouter } from "../../AppRouter.ts";
import MyEstateCommands from "./MyEstateCommands.tsx";

export interface MyEstateDrawerProps {
  /**
   * The estate to show, or `undefined` when the drawer is closed. Its
   * presence is the open state, so there is no way to be open over nothing.
   */
  estate?: OwnedEstateResource;
  onOpenChange: (open: boolean) => void;
  onChanged: (estate: OwnedEstateResource) => void;
  onDeleted: (id: string) => void;
  /**
   * A freshly rotated secret, for the page to reveal once.
   */
  onSecret: (secret: string) => void;
}

/**
 * The stats intervals offered, in seconds. A short list rather than a free
 * field: the value reaches the machine in its `welcome` frame and an
 * arbitrary number there is a UX choice nobody needs to make by hand.
 */
const INTERVALS = [300, 900, 1800, 3600, 21_600, 86_400];

/**
 * Everything about one estate that is not worth a row: the two switches, the
 * stats interval, the projects it is lent to, its command queue, and the two
 * actions that touch the credential.
 *
 * This is `MyEstateCard`'s body, moved behind a click (feedback #2110). The
 * content is deliberately unchanged - including `MyEstateCommands`, which
 * moves as-is rather than being rewritten in the same pass.
 *
 * ⚠️ **A drawer is not a permission boundary.** Every action here is enforced
 * server-side on the row's owner (`EstateService.loadOwned` answers 404 for
 * anyone else). This decides what to draw and nothing more, which is exactly
 * as true now that it is hidden behind a click as it was when it was on the
 * page.
 *
 * The delete confirmation says what deleting does NOT do, because the
 * intuitive reading is the opposite: nothing is undeployed, and a
 * `cloudflare` credential is not revoked at Cloudflare, only a `bay` secret
 * Lore minted itself.
 */
const MyEstateDrawer = (props: MyEstateDrawerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const router = useRouter<AppRouter>();
  const api = useClient<EstateController>();
  const projectEstateApi = useClient<ProjectEstateController>();
  const [busy, setBusy] = useState(false);
  const estate = props.estate;

  const fail = (error: unknown) =>
    toaster.error(error instanceof Error ? error.message : String(error));

  const update = async (body: EstateSwitches) => {
    if (!estate) return;
    setBusy(true);
    try {
      const updated = await api.updateEstate({
        params: { estateId: estate.id },
        body,
      });
      props.onChanged({ ...updated, projects: estate.projects });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!estate) return;
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
      props.onChanged({ ...rotated, projects: estate.projects });
      // Rotation only reaches a bay estate, so a secret always comes back;
      // the field is optional because a cloudflare create mints nothing, and
      // the guard is what makes that impossible to forget here.
      if (secret) {
        props.onSecret(secret);
      }
      toaster.success(tr("account.estates.toast.rotated"));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!estate) return;
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
      props.onDeleted(estate.id);
      // The estate this drawer is about no longer exists, so it cannot stay
      // open over it.
      props.onOpenChange(false);
      toaster.success(tr("account.estates.toast.deleted"));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const detach = async (loan: OwnedEstateResource["projects"][number]) => {
    if (!estate) return;
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
      props.onChanged({
        ...estate,
        projects: estate.projects.filter((item) => item.id !== loan.id),
      });
      toaster.success(tr("estates.toast.detached"));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={Boolean(estate)}
      onOpenChange={(next) => props.onOpenChange(next)}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 overflow-y-auto data-[side=right]:sm:max-w-xl"
        data-testid="my-estate-drawer"
      >
        {estate && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="truncate">{estate.slug}</span>
                <Badge variant="outline">{estate.type}</Badge>
                <Badge variant={estate.online ? "default" : "outline"}>
                  {estate.online ? tr("estates.online") : tr("estates.offline")}
                </Badge>
              </SheetTitle>
              <SheetDescription>
                {/* Truncated, here as in the row: the cleartext is gone the
                    moment its dialog is dismissed. */}
                {estate.secretPrefix &&
                  tr("account.estates.secretPrefix", {
                    args: [estate.secretPrefix],
                  })}
                {estate.secretPrefix && " · "}
                {estate.cpuPercent !== undefined &&
                estate.memoryPercent !== undefined
                  ? tr("account.estates.gauge", {
                      args: [
                        String(Math.round(estate.cpuPercent)),
                        String(Math.round(estate.memoryPercent)),
                      ],
                    })
                  : tr("account.estates.gauge.none")}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-3 px-4">
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
                  onCheckedChange={(value) => {
                    void update({ deployAllowed: value });
                  }}
                  aria-label={tr("account.estates.switch.deploys")}
                  data-testid="my-estate-deploys"
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
                  onCheckedChange={(value) => {
                    void update({ collectSeries: value });
                  }}
                  aria-label={tr("account.estates.switch.series")}
                  data-testid="my-estate-series"
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
            </div>

            <div className="flex flex-col gap-2 border-t px-4 pt-4">
              <span className="text-muted-foreground text-xs">
                {estate.projects.length === 0
                  ? tr("account.estates.loans.none")
                  : tr("account.estates.loans.label")}
              </span>
              {estate.projects.map((loan) => (
                <div
                  key={loan.id}
                  className="flex items-center justify-between gap-2 text-sm"
                  data-testid="my-estate-loan"
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
                    onClick={() => {
                      void detach(loan);
                    }}
                  >
                    <Unlink className="size-4" />
                    {tr("estates.detach.action")}
                  </Button>
                </div>
              ))}
            </div>

            <div className="border-t pt-4">
              <MyEstateCommands estateId={estate.id} />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 pt-4 pb-4">
              {estate.type === "bay" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void rotate();
                  }}
                  data-testid="my-estate-rotate"
                >
                  <RefreshCw className="size-4" />
                  {tr("account.estates.rotate")}
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void remove();
                }}
                data-testid="my-estate-delete"
              >
                <Trash2 className="size-4" />
                {tr("account.estates.delete")}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

/**
 * What one switch change sends: an omitted key is left alone server-side.
 */
interface EstateSwitches {
  label?: string;
  collectSeries?: boolean;
  deployAllowed?: boolean;
  statsIntervalSeconds?: number;
}

export default MyEstateDrawer;
