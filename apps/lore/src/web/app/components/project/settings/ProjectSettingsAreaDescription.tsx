import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Textarea,
} from "@alepha/ui";
import { settingsCardEdge } from "@alepha/ui/settings";
import { useAction, useClient } from "alepha/react";
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
  const areaApi = useClient<AreaController>();
  const [value, setValue] = useState(props.area.description);

  const saveAction = useAction<[], void>(
    {
      handler: async () => {
        await areaApi.updateArea({
          params: { id: props.area.id },
          body: { description: value },
        });
      },
    },
    [areaApi, props.area.id, value],
  );
  const saving = saveAction.loading;
  const save = saveAction.run;

  return (
    <Card className={settingsCardEdge}>
      <CardHeader>
        <CardTitle>{tr("area.detail.description.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* ⚠️ Deliberately not a `LoreEditor` (#Q2069). One or two lines
            naming what an area is for, shown in a settings card - a format
            toolbar, a mode toggle and a CodeMirror chunk is more chrome than
            the field is. */}
        <Textarea
          value={value}
          rows={4}
          placeholder={tr("area.detail.description.placeholder")}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
        <div className="flex justify-end">
          <Button
            onClick={() => void save()}
            disabled={
              saving ||
              value === props.area.description ||
              !areaApi.updateArea.can()
            }
          >
            {tr("area.detail.description.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProjectSettingsAreaDescription;
