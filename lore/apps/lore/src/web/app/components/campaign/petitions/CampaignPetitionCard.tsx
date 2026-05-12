import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bug, Paperclip, Sparkles } from "lucide-react";
import type { PetitionResource } from "@/api/schemas/petitionResourceSchema.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface CampaignPetitionCardProps {
  petition: PetitionResource;
  onClick: () => void;
}

const CampaignPetitionCard = (props: CampaignPetitionCardProps) => {
  const { petition } = props;
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);

  const Icon = petition.reportType === "bug" ? Bug : Sparkles;
  const iconColor =
    petition.reportType === "bug" ? "text-red-500" : "text-emerald-500";

  let hostname = "";
  if (petition.context?.url) {
    try {
      hostname = new URL(petition.context.url).hostname;
    } catch {
      hostname = petition.context.url.slice(0, 60);
    }
  }

  const reporterLabel =
    petition.reporter?.name ??
    petition.reporter?.username ??
    String(tr("petitions.unknownReporter"));

  const attachmentCount = petition.attachmentUrls?.length ?? 0;

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
            <h3 className="truncate text-sm font-medium">{petition.title}</h3>
            <span className="text-muted-foreground shrink-0 text-xs">
              {dt.of(petition.createdAt).fromNow()}
            </span>
          </div>
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {petition.description}
          </p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span>{reporterLabel}</span>
            {hostname && (
              <span>
                <span className="text-foreground/80 font-medium">
                  {hostname}
                </span>
              </span>
            )}
            {attachmentCount > 0 && (
              <span className="flex items-center gap-1">
                <Paperclip className="size-3" />
                {attachmentCount}
              </span>
            )}
            {petition.status !== "pending" && (
              <span className="rounded-full bg-muted px-2 py-0.5 uppercase tracking-wide">
                {petition.status}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CampaignPetitionCard;
