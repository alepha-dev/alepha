import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { StackTarget } from "./stackTarget.ts";
import { useStackServices } from "./useStackServices.ts";

export interface StackVolumesTabProps {
  target: StackTarget;
}

/**
 * The applied revision's named volumes and whether a backup hook covers each,
 * as the machine last reported. A volume no hook covers is data with no copy
 * anywhere, and the page says so by name.
 */
const StackVolumesTab = (props: StackVolumesTabProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { data } = useStackServices(props.target);
  const volumes = data?.volumes ?? [];

  return (
    <Card data-testid="stack-volumes">
      <CardHeader>
        <CardTitle className="text-base">
          {tr("stacks.volumes.title")}
        </CardTitle>
        <CardDescription>{tr("stacks.volumes.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y text-sm">
        {volumes.length === 0 ? (
          <p className="text-muted-foreground">{tr("stacks.volumes.empty")}</p>
        ) : null}
        {volumes.map((volume) => (
          <div
            key={volume.name}
            className="flex items-center gap-3 py-2"
            data-testid="stack-volume-row"
          >
            <span className="font-mono font-medium">{volume.name}</span>
            {volume.backedUp === undefined ? (
              <span className="text-muted-foreground">
                {tr("stacks.volumes.unknown")}
              </span>
            ) : volume.backedUp ? (
              <Badge variant="outline">{tr("stacks.volumes.backedUp")}</Badge>
            ) : (
              <Badge variant="destructive">
                {tr("stacks.volumes.notBackedUp")}
              </Badge>
            )}
          </div>
        ))}
        <p className="text-muted-foreground pt-2 text-xs">
          {tr("stacks.volumes.sizes")}
        </p>
      </CardContent>
    </Card>
  );
};

export default StackVolumesTab;
