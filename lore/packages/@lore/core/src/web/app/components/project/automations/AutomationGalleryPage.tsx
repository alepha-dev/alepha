import { Button } from "@alepha/ui";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import type { AutomationPresetDescriptor } from "../../../../../api/schemas/automationPresetDescriptorSchema.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { AutomationRouter } from "../../../AutomationRouter.ts";
import type { I18n } from "../../../services/I18n.ts";
import AutomationPresetSetup from "./AutomationPresetSetup.tsx";

/**
 * Available stock programs create independent rules through typed setup.
 */
const AutomationGalleryPage = () => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const { tr } = useI18n<I18n, "en">();
  const [selected, setSelected] = useState<AutomationPresetDescriptor>();
  const router = useRouter<AutomationRouter>();
  const catalogue = useQuery(
    {
      key: ["automation-catalog", project?.id],
      enabled: !!project,
      handler: () =>
        api.getAutomationCatalog({ params: { projectId: project!.id } }),
    },
    [project?.id],
  );
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
  const preset = selected;
  return (
    <div className="flex flex-col gap-4 p-4">
      <Button
        variant="minimal"
        className="self-start"
        onClick={() =>
          router.push("projectAutomations", {
            params: { projectSlug: project!.slug },
          })
        }
      >
        {tr("automation.gallery.back")}
      </Button>
      <div>
        <h1 className="text-xl font-semibold">
          {tr("automation.gallery.title")}
        </h1>
        <p className="text-muted-foreground text-sm">
          {tr("automation.gallery.description")}
        </p>
      </div>
      {!preset && !catalogue.loading && available.length === 0 && (
        <p className="text-muted-foreground">{tr("automation.gallery.none")}</p>
      )}
      {preset ? (
        <AutomationPresetSetup
          key={`${project?.id}:${preset.key}`}
          preset={preset}
          channels={catalogue.data?.channels ?? []}
          onCancel={() => setSelected(undefined)}
        />
      ) : (
        available.map((preset) => (
          <div
            key={preset.key}
            className="border-border flex max-w-3xl flex-col gap-1 border-b py-4"
          >
            <h2 className="font-medium">
              {tr(`automation.preset.${preset.key}.title` as never, {
                default: preset.title,
              })}
            </h2>
            <p className="text-muted-foreground text-sm">
              {tr(`automation.preset.${preset.key}.description` as never, {
                default: preset.description,
              })}
            </p>
            <Button
              variant="outlined"
              className="mt-2 self-start"
              onClick={() => setSelected(preset)}
            >
              {tr("automation.setup.choose")}
            </Button>
          </div>
        ))
      )}
    </div>
  );
};

export default AutomationGalleryPage;
