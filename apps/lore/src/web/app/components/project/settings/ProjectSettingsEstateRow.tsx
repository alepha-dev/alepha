import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { CardContent } from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { Unlink } from "lucide-react";

import type { LentEstateResource } from "@/api/controllers/ProjectEstateController.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsEstateRowProps {
  estate: LentEstateResource;
  /**
   * Whether the viewer may withdraw the loan: the project owner, or the
   * estate's own owner. The server enforces the same rule; this only decides
   * whether the button is drawn.
   */
  canDetach: boolean;
  onDetach: (estate: LentEstateResource) => void;
}

/**
 * One estate lent to the project, as its members see it: the slug with the
 * owner's name beside it (two owners may both have `ovh-1`), whether the
 * machine is up, and whether it accepts deploys or only reports stats.
 */
const ProjectSettingsEstateRow = (props: ProjectSettingsEstateRowProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const estate = props.estate;

  return (
    <CardContent
      data-testid="estate-row"
      className="flex flex-wrap items-center gap-3 px-4 py-3"
    >
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{estate.slug}</span>
          {estate.label && (
            <span className="text-muted-foreground truncate text-xs font-normal">
              {estate.label}
            </span>
          )}
        </span>
        <span className="text-muted-foreground text-xs">
          {tr("estates.project.lentBy", { args: [estate.owner.name] })}
          {" · "}
          {estate.type === "cloudflare"
            ? tr("estates.type.cloudflare")
            : estate.lastSeenAt
              ? tr("estates.lastSeen", {
                  args: [String(l(estate.lastSeenAt, { date: "lll" }))],
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
          variant="ghost"
          size="sm"
          aria-label={tr("estates.detach.action")}
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
