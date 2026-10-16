import { Button } from "@alepha/ui";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  ArrowLeft,
  Bug,
  Clock,
  Flag,
  Gauge,
  Inbox,
  Layers,
  ListTodo,
  Rocket,
  Zap,
} from "lucide-react";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationPresetDescriptor } from "../../../../../api/schemas/automationPresetDescriptorSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationPage from "./AutomationPage.tsx";
import AutomationPresetSetup from "./AutomationPresetSetup.tsx";
import { useAutomationLabels } from "./useAutomationLabels.ts";

/**
 * New automation: the presets this project and rank can use, as cards. Picking
 * one opens its few inputs in place; creating lands on the new rule's page,
 * where it is tested and enabled.
 */
const AutomationGalleryPage = () => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const [selected, setSelected] = useState<AutomationPresetDescriptor>();
  const router = useRouter<AutomationRouter>();
  const catalogue = useQuery(
    {
      key: ["automation-catalog", project?.id],
      enabled: !!project,
      handler: ({ signal }) =>
        api.getAutomationCatalog(
          { params: { projectId: project!.id } },
          { request: { signal } },
        ),
    },
    [project?.id],
  );
  if (!project) return null;
  const available = (catalogue.data?.presets ?? []).filter(
    (preset) =>
      preset.available &&
      catalogue.data?.channels.some(
        (channel) =>
          channel.available &&
          (!preset.slots.channel?.values ||
            preset.slots.channel.values.includes(channel.key)),
      ),
  );
  const icons: Record<string, typeof Zap> = {
    "feedback-created": Inbox,
    "tagged-quest-digest": ListTodo,
    "epic-completed": Layers,
    "release-to-folio": Flag,
    "coverage-regression": Gauge,
    "blight-crossing": Bug,
    "deploy-failed": Rocket,
  };
  const title = (preset: AutomationPresetDescriptor) =>
    tr(`automation.preset.${preset.key}.title` as never, {
      default: preset.title,
    });
  const description = (preset: AutomationPresetDescriptor) =>
    tr(`automation.preset.${preset.key}.description` as never, {
      default: preset.description,
    });
  const toList = () =>
    router.push("projectAutomations", {
      params: { projectSlug: project.slug },
    });
  if (selected)
    return (
      <AutomationPage
        title={title(selected)}
        description={description(selected)}
        actions={
          <Button variant="minimal" onClick={() => setSelected(undefined)}>
            <ArrowLeft className="size-4" />
            {tr("automation.gallery.backToPresets")}
          </Button>
        }
      >
        <AutomationPresetSetup
          key={`${project.id}:${selected.key}`}
          preset={selected}
          channels={catalogue.data?.channels ?? []}
          onCancel={() => setSelected(undefined)}
        />
      </AutomationPage>
    );
  return (
    <AutomationPage
      title={tr("automation.new")}
      description={tr("automation.gallery.description")}
      actions={
        <Button variant="minimal" onClick={toList}>
          <ArrowLeft className="size-4" />
          {tr("automation.gallery.back")}
        </Button>
      }
    >
      {catalogue.loading && !catalogue.data && (
        <p className="text-muted-foreground text-sm">
          {tr("automation.editor.loading")}
        </p>
      )}
      {catalogue.data && available.length === 0 && (
        <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
          {tr("automation.gallery.none")}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {available.map((preset) => {
          const Icon = icons[preset.key] ?? Zap;
          return (
            <button
              key={preset.key}
              type="button"
              data-testid={`automation-preset-${preset.key}`}
              className="bg-card hover:border-primary/60 focus-visible:ring-ring/50 flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
              onClick={() => setSelected(preset)}
            >
              <span className="flex items-center gap-2 font-medium">
                <Icon className="text-muted-foreground size-4 shrink-0" />
                {title(preset)}
              </span>
              <span className="text-muted-foreground text-sm">
                {description(preset)}
              </span>
              <span className="text-muted-foreground mt-auto flex items-center gap-1.5 pt-1 text-xs">
                {preset.schedule ? (
                  <Clock className="size-3" />
                ) : (
                  <Zap className="size-3" />
                )}
                {preset.schedule
                  ? labels.schedule(preset.schedule)
                  : (labels.events[preset.source] ?? preset.source)}
              </span>
            </button>
          );
        })}
      </div>
    </AutomationPage>
  );
};

export default AutomationGalleryPage;
