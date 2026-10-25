import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@alepha/ui";
import { type I18n, useRank } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import StackCard from "./StackCard.tsx";
import StackCreateForm from "./StackCreateForm.tsx";
import { useProjectStacks } from "./useProjectStacks.ts";

/**
 * Every stack of the project and its environments (#Q2696). A stack is a
 * compose file's services and the project's apps, deployed together to an
 * estate, one copy per environment.
 */
const ProjectStacks = () => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const { project, stacks, estates, loading } = useProjectStacks();

  if (!project) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="project-stacks">
      <div>
        <h1 className="text-lg font-semibold">{tr("stacks.title")}</h1>
        <p className="text-muted-foreground text-sm">
          {tr("stacks.description")}
        </p>
      </div>
      {loading && stacks.length === 0 ? <Spinner /> : null}
      {!loading && stacks.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tr("stacks.empty")}</CardTitle>
            <CardDescription>{tr("stacks.empty.description")}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {stacks.map((stack) => (
        <StackCard
          key={stack.id}
          projectId={project.id}
          projectSlug={project.slug ?? String(project.id)}
          stack={stack}
          estates={estates}
        />
      ))}
      {can("deploy:manage") ? (
        <StackCreateForm projectId={project.id} estates={estates} />
      ) : null}
    </div>
  );
};

export default ProjectStacks;
