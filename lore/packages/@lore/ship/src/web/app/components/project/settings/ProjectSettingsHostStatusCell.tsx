import { Badge } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { ProjectHostTableRow } from "./projectHostTableRow.ts";

export interface ProjectSettingsHostStatusCellProps {
  row: ProjectHostTableRow;
}

/**
 * Whether the host can take a deploy now. A member deciding whether to
 * deploy needs "invalid" more than "offline", and "offline" is false for a
 * `cloudflare` host, which never connects (#1630): that kind shows its
 * credential instead. A provisioned host says so (#Q3168), and one past
 * the TTL it was given says it is still billing (#Q3138).
 */
const ProjectSettingsHostStatusCell = (
  props: ProjectSettingsHostStatusCellProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const host = props.row.owned ?? props.row.loan;
  if (!host) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {host.type === "cloudflare" ? (
        host.credentialStatus ? (
          <Badge
            variant={
              host.credentialStatus === "valid" ? "default" : "destructive"
            }
          >
            {host.credentialStatus === "valid"
              ? tr("hosts.credential.valid")
              : tr("hosts.credential.invalid")}
          </Badge>
        ) : (
          <Badge variant="outline">{tr("hosts.type.cloudflare")}</Badge>
        )
      ) : (
        <Badge variant={host.online ? "default" : "outline"}>
          {host.online ? tr("hosts.online") : tr("hosts.offline")}
        </Badge>
      )}
      {props.row.owned?.providerServerId ? (
        <Badge variant="outline" data-testid="home-host-provisioned">
          {tr("hosts.provisioned", {
            args: [
              props.row.owned.provider ?? "",
              props.row.owned.providerServerType ?? "",
            ],
          })}
        </Badge>
      ) : null}
      {host.overdue ? (
        <Badge variant="destructive" data-testid="home-host-overdue">
          {tr("hosts.overdue")}
        </Badge>
      ) : null}
    </div>
  );
};

export default ProjectSettingsHostStatusCell;
