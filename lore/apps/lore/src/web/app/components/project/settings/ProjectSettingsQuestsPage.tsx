import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { cn } from "@alepha/ui/lib/utils";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ProjectFeatures } from "@/api/entities/projects.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

type QuestFeatureKey = "questEstimate" | "questReminder" | "questChrono";

/**
 * Compile-time guard: if a key gets renamed in the entity this conditional
 * type resolves to `never` and the file fails to compile.
 */
type _Check = QuestFeatureKey extends keyof ProjectFeatures ? true : never;
const _questFeatureKeyCheck: _Check = true;
void _questFeatureKeyCheck;

export interface QuestFeatureRow {
  key: QuestFeatureKey;
  labelKey:
    | "project.settings.quests.estimate.label"
    | "project.settings.quests.reminder.label"
    | "project.settings.quests.chrono.label";
  descriptionKey:
    | "project.settings.quests.estimate.description"
    | "project.settings.quests.reminder.description"
    | "project.settings.quests.chrono.description";
}

// Planning, then tracking, then nudging — the order the three read in.
const ROWS: QuestFeatureRow[] = [
  {
    key: "questEstimate",
    labelKey: "project.settings.quests.estimate.label",
    descriptionKey: "project.settings.quests.estimate.description",
  },
  {
    key: "questChrono",
    labelKey: "project.settings.quests.chrono.label",
    descriptionKey: "project.settings.quests.chrono.description",
  },
  {
    key: "questReminder",
    labelKey: "project.settings.quests.reminder.label",
    descriptionKey: "project.settings.quests.reminder.description",
  },
];

const ProjectSettingsQuestsPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);

  if (!project) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          {tr("project.settings.quests.title")}
        </span>
        <span className="text-muted-foreground text-xs">
          {tr("project.settings.quests.subtitle")}
        </span>
      </div>

      <Card className={cn(settingsCardEdge, "gap-0 divide-y py-0")}>
        {ROWS.map((row) => (
          <ProjectSettingsQuestsPageRow key={row.key} row={row} />
        ))}
      </Card>
    </div>
  );
};

export interface ProjectSettingsQuestsPageRowProps {
  row: QuestFeatureRow;
}

const ProjectSettingsQuestsPageRow = (
  props: ProjectSettingsQuestsPageRowProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const { enabled, toggle } = useProjectFeatureToggle(props.row.key);

  return (
    <CardContent className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {tr(props.row.labelKey)}
        </span>
        <span className="text-muted-foreground text-xs">
          {tr(props.row.descriptionKey)}
        </span>
      </div>
      <div className="flex justify-start sm:justify-end">
        <Switch
          checked={enabled}
          onCheckedChange={(value) => {
            void toggle(value);
          }}
          aria-label={tr(props.row.labelKey)}
        />
      </div>
    </CardContent>
  );
};

export default ProjectSettingsQuestsPage;
