import { Button, Card, CardContent } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ArrowRightLeft } from "lucide-react";

import type { HostResource } from "../../../../api/schemas/hostResourceSchema.ts";

export interface BaySettingsHomeProps {
  host: HostResource;
  /**
   * Offered only to a reader whose rank lets them move it away: the move
   * takes `host:delete` here.
   */
  onMove?: () => void;
  busy: boolean;
}

/**
 * Whose host this is (#E126): its home project, whose members manage it,
 * and who added it. A provisioned server lives in that person's cloud
 * account, which is why they are named here.
 */
const BaySettingsHome = (props: BaySettingsHomeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const host = props.host;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 text-sm">
          <span data-testid="bay-settings-home">
            {tr("bay.settings.home", {
              args: [host.project?.title ?? tr("hosts.project.noHome")],
            })}
          </span>
          {host.creator && (
            <span
              className="text-muted-foreground text-xs"
              data-testid="bay-settings-creator"
            >
              {host.provider
                ? tr("bay.settings.provisionedBy", {
                    args: [host.creator.name],
                  })
                : tr("bay.settings.addedBy", { args: [host.creator.name] })}
            </span>
          )}
        </div>
        {props.onMove && (
          <Button
            variant="outlined"
            size="sm"
            disabled={props.busy}
            onClick={props.onMove}
            data-testid="bay-settings-move"
          >
            <ArrowRightLeft className="size-4" />
            {tr("bay.move.action")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default BaySettingsHome;
