import { Button, Card, CardContent } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { ArrowRightLeft } from "lucide-react";

import type { EstateResource } from "../../../../api/schemas/estateResourceSchema.ts";

export interface BaySettingsHomeProps {
  estate: EstateResource;
  /**
   * Offered only to a reader whose rank lets them move it away: the move
   * takes `estate:delete` here.
   */
  onMove?: () => void;
  busy: boolean;
}

/**
 * Whose estate this is (#E126): its home project, whose members manage it,
 * and who added it. A provisioned server lives in that person's cloud
 * account, which is why they are named here.
 */
const BaySettingsHome = (props: BaySettingsHomeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const estate = props.estate;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 text-sm">
          <span data-testid="bay-settings-home">
            {tr("bay.settings.home", {
              args: [estate.project?.title ?? tr("estates.project.noHome")],
            })}
          </span>
          {estate.creator && (
            <span
              className="text-muted-foreground text-xs"
              data-testid="bay-settings-creator"
            >
              {estate.provider
                ? tr("bay.settings.provisionedBy", {
                    args: [estate.creator.name],
                  })
                : tr("bay.settings.addedBy", { args: [estate.creator.name] })}
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
