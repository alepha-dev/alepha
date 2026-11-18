import { Button } from "@alepha/ui";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  ArrowLeft,
  Bug,
  Flag,
  Gauge,
  Inbox,
  Layers,
  ListTodo,
  PenTool,
  Rocket,
  Zap,
} from "lucide-react";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationPresetDescriptor } from "../../../../../api/schemas/automationPresetDescriptorSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { usePageCrumb } from "../../shared/usePageCrumb.ts";
import AutomationPage from "./AutomationPage.tsx";
import AutomationPresetSetup from "./AutomationPresetSetup.tsx";
import AutomationOutlineFolded from "./outline/AutomationOutlineFolded.tsx";
import { AutomationOutlineIcons } from "./outline/AutomationOutlineIcons.ts";
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
  // The trail ends with this page (#Q3408).
  usePageCrumb("projectAutomationGallery", tr("automation.new"));
  const labels = useAutomationLabels();
  const router = useRouter();
  const [selected, setSelected] = useState<AutomationPresetDescriptor>();
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
    "error-crossing": Bug,
    "deploy-failed": Rocket,
  };
  const title = (preset: AutomationPresetDescriptor) =>
    tr(`automation.preset.${preset.key}.title`, {
      default: preset.title,
    });
  const description = (preset: AutomationPresetDescriptor) =>
    tr(`automation.preset.${preset.key}.description`, {
      default: preset.description,
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
        // An empty draft, on "Choose what starts it" (#Q3812, #Q3848).
        <Button
          variant="outlined"
          data-testid="automation-start-scratch"
          onClick={() =>
            router.push("projectAutomationNew", {
              params: { projectSlug: project.slug },
              query: {},
            })
          }
        >
          <PenTool className="size-4" />
          {tr("automation.gallery.scratch")}
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
              {preset.sketch && (
                // The one line a folded block reads as (#Q3851).
                <div className="-mx-1 overflow-hidden rounded-md border">
                  <AutomationOutlineFolded
                    event={
                      preset.schedule
                        ? labels.schedule(preset.schedule)
                        : (labels.events[preset.sketch.source] ??
                          preset.sketch.source)
                    }
                    eventIcon={AutomationOutlineIcons.of({
                      kind: "source",
                      type: preset.sketch.source,
                    })}
                    detail={[
                      ...(preset.sketch.read
                        ? [
                            tr(`automation.source.${preset.sketch.read}`, {
                              default: preset.sketch.read,
                            }),
                          ]
                        : []),
                      ...(preset.sketch.condition
                        ? [tr("automation.outline.withCondition")]
                        : []),
                    ].join(", ")}
                    action={
                      preset.sketch.action
                        ? tr(`automation.action.${preset.sketch.action}`, {
                            default: preset.sketch.action,
                          })
                        : undefined
                    }
                    actionIcon={
                      preset.sketch.action
                        ? AutomationOutlineIcons.of({
                            kind: "action",
                            type: preset.sketch.action,
                          })
                        : undefined
                    }
                    more={preset.sketch.more}
                    compact
                    testId="automation-preset-line"
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </AutomationPage>
  );
};

export default AutomationGalleryPage;
