import { Badge } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../../services/I18n.ts";
import HostStateBadge from "../../hosts/HostStateBadge.tsx";
import type { ProjectHostTableRow } from "./projectHostTableRow.ts";

export interface ProjectSettingsHostStatusCellProps {
  row: ProjectHostTableRow;
}

/**
 * Whether the host can take a deploy now: the state pill Admin > Hosts
 * draws (#Q4047), which reads a `cloudflare` host through its credential
 * (#1630). A provisioned host says so (#Q3168), and one past the TTL it was
 * given says it is still billing (#Q3138).
 */
const ProjectSettingsHostStatusCell = (
  props: ProjectSettingsHostStatusCellProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const host = props.row.owned ?? props.row.loan;
  if (!host) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* The pill Admin > Hosts draws (#Q4047): online or offline, a
          cloudflare account read through its credential. */}
      <HostStateBadge
        type={host.type}
        online={host.online}
        credentialStatus={host.credentialStatus}
      />
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
