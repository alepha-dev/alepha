import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

import LoreViewer from "../../shared/element/LoreViewer.tsx";

export interface ProjectEpicDescriptionProps {
  epic: EpicResource;
}

/**
 * The Overview tab of the Epic page: the rich description, rendered
 * read-only.
 *
 * Owns its own scroll container and padding, because `DetailLayout` renders
 * `children` raw — the shell holds the aside and the toolbar and takes no
 * position on what a tab body looks like inside.
 */
const ProjectEpicDescription = (props: ProjectEpicDescriptionProps) => {
  const { tr } = useI18n<I18n, "en">();
  // The links this produces are URLs, so it needs the project's slug, which
  // the surrounding project layout has already loaded.
  const [project] = useStore(currentProjectAtom);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>{tr("epic.description.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {props.epic.description ? (
            <LoreViewer
              element={{
                kind: "epic",
                projectId: props.epic.projectId,
                projectSlug: project?.slug ?? "",
                id: props.epic.id,
              }}
              content={props.epic.description}
            />
          ) : (
            <p className="text-muted-foreground text-sm italic">
              {tr("epic.description.empty")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ProjectEpicDescription;
