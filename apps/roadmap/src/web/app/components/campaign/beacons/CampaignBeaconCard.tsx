import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bug, Sparkles } from "lucide-react";
import type { BeaconResource } from "@/api/schemas/beaconResourceSchema.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface CampaignBeaconCardProps {
  beacon: BeaconResource;
  onClick: () => void;
}

const CampaignBeaconCard = (props: CampaignBeaconCardProps) => {
  const { beacon } = props;
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);

  const Icon = beacon.reportType === "bug" ? Bug : Sparkles;
  const iconColor =
    beacon.reportType === "bug" ? "text-red-500" : "text-emerald-500";

  let hostname = "";
  try {
    hostname = new URL(beacon.context.url).hostname;
  } catch {
    hostname = beacon.context.url.slice(0, 60);
  }

  return (
    <Card
      className="hover:bg-muted/30 cursor-pointer transition-colors"
      onClick={props.onClick}
    >
      <CardContent className="flex gap-3 p-3">
        <div className="flex flex-col items-center gap-1 pt-1">
          <Icon className={`size-5 shrink-0 ${iconColor}`} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-sm font-medium">{beacon.title}</h3>
            <span className="text-muted-foreground shrink-0 text-xs">
              {dt.of(beacon.createdAt).fromNow()}
            </span>
          </div>
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {beacon.description}
          </p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span>{beacon.reporterEmail ?? tr("beacons.anonymous")}</span>
            {hostname && (
              <span>
                <span className="text-foreground/80 font-medium">
                  {hostname}
                </span>
              </span>
            )}
            {beacon.status !== "new" && (
              <span className="rounded-full bg-muted px-2 py-0.5 uppercase tracking-wide">
                {beacon.status}
              </span>
            )}
          </div>
        </div>

        {beacon.screenshotUrl && (
          <img
            src={beacon.screenshotUrl}
            alt=""
            width={96}
            height={64}
            className="border-border h-16 w-24 shrink-0 rounded border object-cover"
          />
        )}
      </CardContent>
    </Card>
  );
};

export default CampaignBeaconCard;
