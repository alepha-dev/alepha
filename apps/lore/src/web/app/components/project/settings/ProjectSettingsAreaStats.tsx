import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { AreaDetail } from "@/api/schemas/areaResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsAreaStatsProps {
  area: AreaDetail;
}

/**
 * The activity rollup: open vs total quests, and when this area was first
 * and last touched.
 */
const ProjectSettingsAreaStats = (props: ProjectSettingsAreaStatsProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);

  const figures = [
    {
      label: tr("area.detail.stats.open"),
      value: String(props.area.openQuestCount),
    },
    {
      label: tr("area.detail.stats.total"),
      value: String(props.area.questCount),
    },
    {
      label: tr("area.detail.stats.first"),
      value: props.area.firstQuestAt
        ? dt.of(props.area.firstQuestAt).fromNow()
        : String(tr("area.detail.stats.never")),
    },
    {
      label: tr("area.detail.stats.last"),
      value: props.area.lastQuestAt
        ? dt.of(props.area.lastQuestAt).fromNow()
        : String(tr("area.detail.stats.never")),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("area.detail.stats.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {figures.map((f) => (
          <div key={String(f.label)} className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">{f.label}</span>
            <span className="text-lg font-semibold">{f.value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default ProjectSettingsAreaStats;
