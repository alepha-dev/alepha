import { Badge, Button, CardContent } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Unlink } from "lucide-react";

import type { LentEstateResource } from "../../../../../api/controllers/ProjectEstateController.ts";

export interface ProjectSettingsEstateRowProps {
  estate: LentEstateResource;
  /**
   * Whether the viewer may withdraw the loan: the project owner, or the
   * estate's own owner. The server enforces the same rule; this only decides
   * whether the button is drawn.
   */
  canDetach: boolean;
  onDetach: (estate: LentEstateResource) => void;
  /**
   * True while a detach runs on any row: the page holds one action for all
   * of them, so every row's button waits (#E59 rule 10).
   */
  busy?: boolean;
}

/**
 * One estate lent to the project, as its members see it: the slug with its
 * home project beside it (two projects may both have `ovh-1`), whether the
 * machine is up, and whether it accepts deploys or only reports stats.
 *
 * ⚠️ The slug is a link to the Bay console **only for a reader who may read
 * it in the home project** (feedback #P2126, #E126). The console answers 403
 * to a member of a project that only borrows the estate, so a link on their
 * row would promise a page that does not exist for them. `can` is computed by
 * the server for exactly this, never recomputed here.
 */
const ProjectSettingsEstateRow = (props: ProjectSettingsEstateRowProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const router = useRouter();
  const estate = props.estate;

  return (
    <CardContent
      data-testid="estate-row"
      className="flex flex-wrap items-center gap-3 px-4 py-3"
    >
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          {estate.can.includes("estate:read") ? (
            <Link
              href={router.path("bay", { params: { estateId: estate.id } })}
              className="truncate hover:underline"
            >
              {estate.slug}
            </Link>
          ) : (
            <span className="truncate">{estate.slug}</span>
          )}
          {estate.label && (
            <span className="text-muted-foreground truncate text-xs font-normal">
              {estate.label}
            </span>
          )}
        </span>
        <span className="text-muted-foreground text-xs">
          {estate.isHome
            ? tr("estates.project.home")
            : tr("estates.project.lentBy", {
                args: [estate.home?.title ?? tr("estates.project.noHome")],
              })}
          {" · "}
          {estate.type === "cloudflare"
            ? tr("estates.type.cloudflare")
            : estate.lastSeenAt
              ? tr("estates.lastSeen", {
                  args: [l(estate.lastSeenAt, { date: "lll" })],
                })
              : tr("estates.neverSeen")}
        </span>
      </div>
      {/* A member deciding whether to deploy needs "invalid" more than
          "offline", and "offline" is false for a row that never connects
          (#1630). Read as optional: a bay row has no status. */}
      {estate.type === "cloudflare" ? (
        <Badge
          variant={
            estate.credentialStatus === "valid" ? "default" : "destructive"
          }
        >
          {estate.credentialStatus === "valid"
            ? tr("estates.credential.valid")
            : tr("estates.credential.invalid")}
        </Badge>
      ) : (
        <Badge variant={estate.online ? "default" : "outline"}>
          {estate.online ? tr("estates.online") : tr("estates.offline")}
        </Badge>
      )}
      <Badge variant="secondary">
        {estate.deployAllowed
          ? tr("estates.deploys.allowed")
          : tr("estates.deploys.statsOnly")}
      </Badge>
      {props.canDetach && (
        <Button
          variant="minimal"
          size="sm"
          aria-label={tr("estates.detach.action")}
          disabled={props.busy}
          onClick={() => props.onDetach(estate)}
        >
          <Unlink className="size-4" />
          {tr("estates.detach.action")}
        </Button>
      )}
    </CardContent>
  );
};

export default ProjectSettingsEstateRow;
