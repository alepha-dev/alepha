import { MarkdownView } from "@alepha/ui/components/markdown-view/markdown-view";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ProjectEpicDescriptionProps {
  epic: EpicResource;
}

/**
 * Zone 2 of the Epic page: the rich description, rendered read-only.
 */
const ProjectEpicDescription = (props: ProjectEpicDescriptionProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("epic.description.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {props.epic.description ? (
          <MarkdownView content={props.epic.description} />
        ) : (
          <p className="text-muted-foreground text-sm italic">
            {tr("epic.description.empty")}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default ProjectEpicDescription;
