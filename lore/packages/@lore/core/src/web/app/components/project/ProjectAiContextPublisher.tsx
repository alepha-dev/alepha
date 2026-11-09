import { useAiContext } from "@alepha/ui/ai";
import { useI18n } from "alepha/react/i18n";

import type { ProjectResource } from "../../../../api/schemas/projectResourceSchema.ts";

export interface ProjectAiContextPublisherProps {
  project: Pick<ProjectResource, "id" | "slug" | "title" | "preferredLanguage">;
}

/**
 * Tells an assistant turn which project it is sent from (#Q3208). Renders
 * nothing.
 *
 * The project rides in the page context, never in the system prompt, because
 * a conversation outlives the page it started on: every turn sent while a
 * project page is mounted carries `{ projectId, projectSlug, projectTitle,
 * language, contentLanguage }`. `language` is the interface's, the one a
 * reply is written in; `contentLanguage` is the one stored content is written
 * in, the project's `preferredLanguage`, English when unset.
 *
 * It names no assistant: it is the framework's generic page context, read by
 * whatever chat the app mounts. A page below may push a narrower context on
 * top; it must carry `projectId` too, since the innermost one is sent.
 *
 * Its own component, mounted by `ProjectView` past its early return, for the
 * reason `ProjectViewNavPublisher` is: its hooks only apply once a project is
 * loaded.
 */
const ProjectAiContextPublisher = (props: ProjectAiContextPublisherProps) => {
  const { lang } = useI18n();
  useAiContext({
    page: "project",
    data: {
      projectId: props.project.id,
      projectSlug: props.project.slug,
      projectTitle: props.project.title,
      language: lang,
      contentLanguage: props.project.preferredLanguage ?? "en",
    },
  });
  return null;
};

export default ProjectAiContextPublisher;
