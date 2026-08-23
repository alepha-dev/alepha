import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useState } from "react";

import type { AreaController } from "@/api/controllers/AreaController.ts";
import type { AreaDetail } from "@/api/schemas/areaResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectSettingsAreaDescriptionProps {
  area: AreaDetail;
}

/**
 * An explicit save, not an autosave: `useForm` anchors its schema at mount,
 * and the value is loader-fed, so a debounced autosave is fiddly for no
 * gain on a field edited once.
 */
const ProjectSettingsAreaDescription = (
  props: ProjectSettingsAreaDescriptionProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const areaApi = useClient<AreaController>();
  const [value, setValue] = useState(props.area.description);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await areaApi.updateArea({
        params: { id: props.area.id },
        body: { description: value },
      });
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={settingsCardEdge}>
      <CardHeader>
        <CardTitle>{tr("area.detail.description.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          value={value}
          rows={4}
          placeholder={String(tr("area.detail.description.placeholder"))}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void save()}
            disabled={saving || value === props.area.description}
          >
            {tr("area.detail.description.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProjectSettingsAreaDescription;
