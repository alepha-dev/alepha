import { cn } from "@alepha/ui/lib/utils";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import {
  ChevronRight,
  Circle,
  CircleCheck,
  CircleX,
  Clock,
  Paperclip,
} from "lucide-react";
import type { PetitionResource } from "@/api/schemas/petitionResourceSchema.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface CampaignPetitionCardProps {
  petition: PetitionResource;
  onClick: () => void;
  selected?: boolean;
}

/**
 * One petition, rendered as a flush, square row in the inbox list — mirrors the
 * admin parameter-history item design. The status icon on the left encodes
 * pending / accepted / rejected; clicking the row selects the petition (the
 * detail pane on the right shows the full content + provenance).
 */
const CampaignPetitionCard = (props: CampaignPetitionCardProps) => {
  const { petition } = props;
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);

  const reporterLabel =
    petition.reporter?.name ??
    petition.reporter?.username ??
    tr("petitions.unknownReporter");
  const attachmentCount = petition.attachmentUrls?.length ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onClick();
        }
      }}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 border-b px-3 py-2.5 transition-colors hover:bg-accent/50",
        props.selected && "bg-accent text-accent-foreground",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {statusIcon(petition.status)}
      </span>
      <div className="ml-1 flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold leading-tight">
          {petition.title}
        </span>
        <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs leading-tight">
          <Clock className="size-3 shrink-0" />
          <span className="shrink-0">
            {dt.of(petition.createdAt).fromNow()}
          </span>
          <span className="shrink-0 opacity-50">·</span>
          {/* Reporter name is user-provided — plain escaped text only. */}
          <span className="truncate">{reporterLabel}</span>
        </span>
      </div>
      {attachmentCount > 0 && (
        <span className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-xs">
          <Paperclip className="size-3" />
          {attachmentCount}
        </span>
      )}
      <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
        <ChevronRight className="size-4" />
      </span>
    </div>
  );
};

export default CampaignPetitionCard;

const statusIcon = (status: PetitionResource["status"]) => {
  if (status === "accepted") {
    return (
      <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
    );
  }
  if (status === "rejected") {
    return <CircleX className="text-muted-foreground size-4" />;
  }
  return <Circle className="text-muted-foreground size-4" />;
};
