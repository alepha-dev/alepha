import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { ProjectEstateTableRow } from "./projectEstateTableRow.ts";

export interface ProjectSettingsEstateStatusCellProps {
  row: ProjectEstateTableRow;
}

/**
 * Whether the estate can take a deploy now. A member deciding whether to
 * deploy needs "invalid" more than "offline", and "offline" is false for a
 * `cloudflare` estate, which never connects (#1630): that kind shows its
 * credential instead. A provisioned estate says so (#Q3168), and one past
 * the TTL it was given says it is still billing (#Q3138).
 */
const ProjectSettingsEstateStatusCell = (
  props: ProjectSettingsEstateStatusCellProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const estate = props.row.owned ?? props.row.loan;
  if (!estate) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {estate.type === "cloudflare" ? (
        estate.credentialStatus ? (
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
          <Badge variant="outline">{tr("estates.type.cloudflare")}</Badge>
        )
      ) : (
        <Badge variant={estate.online ? "default" : "outline"}>
          {estate.online ? tr("estates.online") : tr("estates.offline")}
        </Badge>
      )}
      {props.row.owned?.providerServerId ? (
        <Badge variant="outline" data-testid="home-estate-provisioned">
          {tr("estates.provisioned", {
            args: [
              props.row.owned.provider ?? "",
              props.row.owned.providerServerType ?? "",
            ],
          })}
        </Badge>
      ) : null}
      {estate.overdue ? (
        <Badge variant="destructive" data-testid="home-estate-overdue">
          {tr("estates.overdue")}
        </Badge>
      ) : null}
    </div>
  );
};

export default ProjectSettingsEstateStatusCell;
