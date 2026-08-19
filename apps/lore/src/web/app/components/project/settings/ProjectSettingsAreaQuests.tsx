import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import type { AreaDetail } from "@/api/schemas/areaResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsAreaQuestsProps {
  area: AreaDetail;
}

/**
 * What is actually filed here, so the person deciding whether to merge
 * this area into another can see it without leaving the page.
 */
const ProjectSettingsAreaQuests = (props: ProjectSettingsAreaQuestsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();

  if (props.area.recentQuests.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("area.detail.quests.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {props.area.recentQuests.map((quest) => (
          <Link
            key={quest.shortId}
            href={router.path("projectQuest", {
              params: { shortId: quest.shortId },
            })}
            className="flex items-center gap-2 text-sm"
          >
            <span className="text-muted-foreground">#{quest.shortId}</span>
            <span
              className={quest.completedAt ? "line-through opacity-60" : ""}
            >
              {quest.title}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
};

export default ProjectSettingsAreaQuests;
