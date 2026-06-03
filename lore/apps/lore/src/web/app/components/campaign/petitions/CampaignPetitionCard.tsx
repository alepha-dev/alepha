import { Badge } from "@alepha/ui/components/ui/badge";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { cn } from "@alepha/ui/lib/utils";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Globe, Paperclip } from "lucide-react";
import type { PetitionResource } from "@/api/schemas/petitionResourceSchema.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface CampaignPetitionCardProps {
  petition: PetitionResource;
  onClick: () => void;
  selected?: boolean;
}

const CampaignPetitionCard = (props: CampaignPetitionCardProps) => {
  const { petition } = props;
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);

  const reporterLabel =
    petition.reporter?.name ??
    petition.reporter?.username ??
    tr("petitions.unknownReporter");

  const attachmentCount = petition.attachmentUrls?.length ?? 0;
  const tags = petition.tags ?? [];

  // Provenance badge for sigil-embedded petitions. `source.hostUrl` is
  // attacker-controlled (set by the embedding page) — it MUST only ever be
  // rendered as an escaped plain-text node, never markdown / HTML. The
  // `{hostLabel}` JSX interpolation below escapes by default; do not change
  // it to MarkdownView / dangerouslySetInnerHTML. See folio #12.
  const source = petition.source;
  const hostLabel = (() => {
    if (!source?.sigilId) return undefined;
    try {
      return new URL(source.hostUrl).host;
    } catch {
      // Malformed hostUrl — fall back to the raw value (still a plain
      // text node, still escaped) so the badge degrades gracefully.
      return source.hostUrl || source.hostPath || source.sigilId;
    }
  })();

  return (
    <Card
      className={cn(
        "hover:bg-muted/30 cursor-pointer py-3 transition-colors",
        props.selected && "border-primary bg-muted/40",
      )}
      onClick={props.onClick}
    >
      <CardContent className="flex flex-col gap-1.5 px-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-sm font-medium">{petition.title}</h3>
          <span className="text-muted-foreground shrink-0 text-xs">
            {dt.of(petition.createdAt).fromNow()}
          </span>
        </div>
        <p className="text-muted-foreground line-clamp-2 text-xs">
          {petition.description}
        </p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 4).map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="font-mono text-[10px]"
              >
                {tag}
              </Badge>
            ))}
            {tags.length > 4 && (
              <span className="text-muted-foreground text-[10px]">
                +{tags.length - 4}
              </span>
            )}
          </div>
        )}
        {hostLabel && (
          <div className="flex flex-wrap gap-1">
            <Badge
              variant="outline"
              className="gap-1 text-[10px]"
              title={hostLabel}
            >
              <Globe className="size-3" />
              {tr("petitions.source.viaSigil")} · {hostLabel}
            </Badge>
          </div>
        )}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span>{reporterLabel}</span>
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
      </CardContent>
    </Card>
  );
};

export default CampaignPetitionCard;
