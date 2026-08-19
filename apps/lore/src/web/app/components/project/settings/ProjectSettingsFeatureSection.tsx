import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useI18n } from "alepha/react/i18n";
import type { ProjectFeatures } from "@/api/entities/projects.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

// Limited to the legacy module-level toggles that drive a dedicated
// settings sub-page, plus Epics — which has no sub-page of its own yet and
// renders this section directly on the settings shell instead. Per-quest
// toggles (questNote / questReminder / questChrono) live on the Quests
// settings page and render via a dedicated row component, not this section.
type ModuleFeatureKey =
  | "kanban"
  | "folios"
  | "milestones"
  | "sigils"
  | "feedback"
  | "epics";

// Compile-time guarantee that ModuleFeatureKey stays a subset of
// ProjectFeatures keys — if a key gets renamed in the entity, the
// `satisfies` clause forces this file to update too.
type _Check = ModuleFeatureKey extends keyof ProjectFeatures ? true : never;
const _moduleFeatureKeyCheck: _Check = true;
void _moduleFeatureKeyCheck;

export interface ProjectSettingsFeatureSectionProps {
  featureKey: ModuleFeatureKey;
  enabled: boolean;
  onToggle: (value: boolean) => void | Promise<void>;
}

const DESCRIPTION_KEYS: Record<
  ModuleFeatureKey,
  | "project.settings.feature.kanban.description"
  | "project.settings.feature.folios.description"
  | "project.settings.feature.milestones.description"
  | "project.settings.feature.sigils.description"
  | "project.settings.feature.feedback.description"
  | "project.settings.feature.epics.description"
> = {
  kanban: "project.settings.feature.kanban.description",
  folios: "project.settings.feature.folios.description",
  milestones: "project.settings.feature.milestones.description",
  sigils: "project.settings.feature.sigils.description",
  feedback: "project.settings.feature.feedback.description",
  epics: "project.settings.feature.epics.description",
};

const NAV_KEYS: Record<
  ModuleFeatureKey,
  | "project.settings.nav.kanban"
  | "project.settings.nav.folios"
  | "project.settings.nav.milestones"
  | "project.settings.nav.sigils"
  | "project.settings.nav.feedback"
  | "project.menu.epics"
> = {
  kanban: "project.settings.nav.kanban",
  folios: "project.settings.nav.folios",
  milestones: "project.settings.nav.milestones",
  sigils: "project.settings.nav.sigils",
  feedback: "project.settings.nav.feedback",
  epics: "project.menu.epics",
};

const ProjectSettingsFeatureSection = (
  props: ProjectSettingsFeatureSectionProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const label = tr(NAV_KEYS[props.featureKey]);
  const description = tr(DESCRIPTION_KEYS[props.featureKey]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="py-4 shadow">
        <CardContent className="flex items-center justify-between gap-4 px-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-muted-foreground text-xs">{description}</span>
          </div>
          <Switch
            checked={props.enabled}
            onCheckedChange={(value) => {
              void props.onToggle(value);
            }}
            aria-label={tr("project.settings.feature.enable")}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectSettingsFeatureSection;
