import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { BookOpen, Trash } from "lucide-react";
import type { I18n } from "@/web/app/services/I18n.ts";
import type { ChapterWithCount } from "./CampaignChapters.tsx";

export interface CampaignChaptersRowProps {
  chapter: ChapterWithCount;
  onDelete: (id: number) => void;
  onViewChangelog: (id: number) => void;
}

const CampaignChaptersRow = (props: CampaignChaptersRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const i18n = useI18n();
  const isActive = !props.chapter.closedAt;

  return (
    <Card className="bg-card shadow">
      <CardContent className="flex items-center justify-between gap-3 p-3">
        <div className="flex flex-1 items-center gap-3">
          <Badge
            variant={isActive ? "default" : "secondary"}
            className={isActive ? "bg-green-600 text-white" : undefined}
          >
            #{props.chapter.number}
          </Badge>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-semibold">{props.chapter.title}</span>
            <div className="flex gap-2">
              <span className="text-muted-foreground text-xs">
                {tr("chapter.list.quests", {
                  args: [String(props.chapter.questCount)],
                })}
              </span>
              {props.chapter.closedAt && (
                <span className="text-muted-foreground text-xs">
                  {tr("chapter.list.closed", {
                    args: [
                      String(i18n.l(props.chapter.closedAt, { date: "ll" })),
                    ],
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => props.onViewChangelog(props.chapter.id)}
          >
            <BookOpen className="size-3.5" />
            {tr("chapter.changelog")}
          </Button>
          {props.chapter.questCount === 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => props.onDelete(props.chapter.id)}
            >
              <Trash className="size-3.5" />
              {tr("chapter.delete")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default CampaignChaptersRow;
