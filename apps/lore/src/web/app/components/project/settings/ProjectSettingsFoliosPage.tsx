import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useI18n } from "alepha/react/i18n";
import type { I18n } from "@/web/app/services/I18n.ts";
import ProjectSettingsFeatureSection from "./ProjectSettingsFeatureSection.tsx";
import { useProjectFeatureToggle } from "./useProjectFeatureToggle.ts";

const ProjectSettingsFoliosPage = () => {
  const { tr } = useI18n<I18n, "en">();
  const { enabled, toggle } = useProjectFeatureToggle("folios");
  const summary = useProjectFeatureToggle("folioSummary");

  return (
    <div className="flex flex-col gap-4">
      <ProjectSettingsFeatureSection
        featureKey="folios"
        enabled={enabled}
        onToggle={toggle}
      />

      {/* Off by default (the key is absent from `defaultProjectFeatures`, so
          `useProjectFeatureToggle` reads it as false) — the summary is
          written for agents, not readers. Hiding it never stops it being
          persisted. */}
      <Card className="py-4 shadow">
        <CardContent className="flex items-center justify-between gap-4 px-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              {tr("project.settings.folios.summary.label")}
            </span>
            <span className="text-muted-foreground text-xs">
              {tr("project.settings.folios.summary.description")}
            </span>
          </div>
          <Switch
            checked={summary.enabled}
            onCheckedChange={(value) => {
              void summary.toggle(value);
            }}
            aria-label={tr("project.settings.folios.summary.label")}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectSettingsFoliosPage;
