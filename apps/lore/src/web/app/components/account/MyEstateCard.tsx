import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
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

export interface MyEstateCardProps {
  estate: OwnedEstateResource;
  onChanged: (estate: OwnedEstateResource) => void;
  onDeleted: (id: string) => void;
  /**
   * A freshly rotated secret, for the page to show once.
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
 * One estate its owner holds: identity and liveness, the two switches and
 * the interval, the projects it is lent to, its commands, and the two
 * actions that touch the credential.
 *
 * Switches save on change and the card re-renders from the server's answer,
 * so what is shown is what the row holds. The delete confirmation says what
 * deleting does NOT do, because the intuitive reading is the opposite:
 * nothing is undeployed, and a `cloudflare` credential is not revoked at
 * Cloudflare, only a `bay` secret Lore minted itself.
 */
const MyEstateCard = (props: MyEstateCardProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const toaster = useToast();
  const dialog = useDialog();
  const router = useRouter<AppRouter>();
  const api = useClient<EstateController>();
  const projectEstateApi = useClient<ProjectEstateController>();
  const estate = props.estate;
  const [busy, setBusy] = useState(false);

  const fail = (error: unknown) =>
    toaster.error(error instanceof Error ? error.message : String(error));

  const update = async (body: EstateSwitches) => {
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
      props.onSecret(secret);
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
      props.onDeleted(estate.id);
      toaster.success(tr("account.estates.toast.deleted"));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const detach = async (loan: OwnedEstateResource["projects"][number]) => {
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
    <Card className="gap-0 divide-y py-0" data-testid="my-estate-card">
      <CardContent className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate" data-testid="my-estate-slug">
              {estate.slug}
            </span>
            {estate.label && (
              <span className="text-muted-foreground truncate text-xs font-normal">
                {estate.label}
              </span>
            )}
            <Badge variant="outline">{estate.type}</Badge>
          </span>
          <span className="text-muted-foreground text-xs">
            {estate.secretPrefix &&
              tr("account.estates.secretPrefix", {
                args: [estate.secretPrefix],
              })}
            {estate.secretPrefix && " · "}
            {estate.lastSeenAt
              ? tr("estates.lastSeen", {
                  args: [String(l(estate.lastSeenAt, { date: "lll" }))],
                })
              : tr("estates.neverSeen")}
            {" · "}
            {estate.cpuPercent !== undefined &&
            estate.memoryPercent !== undefined
              ? tr("account.estates.gauge", {
                  args: [
                    String(Math.round(estate.cpuPercent)),
                    String(Math.round(estate.memoryPercent)),
                  ],
                })
              : tr("account.estates.gauge.none")}
          </span>
        </div>
        <Badge variant={estate.online ? "default" : "outline"}>
          {estate.online ? tr("estates.online") : tr("estates.offline")}
        </Badge>
        <Badge variant="secondary">
          {estate.deployAllowed
            ? tr("estates.deploys.allowed")
            : tr("estates.deploys.statsOnly")}
        </Badge>
      </CardContent>

      <CardContent className="flex flex-col gap-3 px-4 py-3">
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
      </CardContent>

      <CardContent className="flex flex-col gap-2 px-4 py-3">
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
      </CardContent>

      <MyEstateCommands estateId={estate.id} />

      <CardContent
        className={cn(
          "flex flex-wrap items-center justify-end gap-2 px-4 py-3",
        )}
      >
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
      </CardContent>
    </Card>
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

export default MyEstateCard;
