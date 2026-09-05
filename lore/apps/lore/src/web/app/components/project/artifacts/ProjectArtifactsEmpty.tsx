import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../../services/I18n.ts";

export interface ProjectArtifactsEmptyProps {
  /**
   * The project's slug, so the command the panel prints is the one this
   * reader would actually run.
   */
  projectSlug: string;
}

/**
 * What the Artifacts page renders before anything has ever been pushed.
 *
 * This is the answer to "what does a project with no artifacts see", and it
 * is the reason the sidebar entry is NOT hidden until the first push: the
 * capability arrives from CI, a foreign system Lore cannot see, so a reader
 * who has never pushed one has no other way to learn it exists. Hiding the
 * entry would also mean counting artifacts in the project route loader, so
 * every reader would pay a request on every project load to decide one nav
 * row.
 *
 * ⚠️ Deliberately close to, but not shared with, `AppArtifactsEmpty`. That
 * one names an app because it lives on that app's page and can; this one
 * cannot, since the whole point of the page is that it spans every app. The
 * command therefore carries a placeholder, and merging the two would mean a
 * prop that is sometimes a real app name and sometimes a stand-in - which is
 * the shape that produces a copy-pasteable command that does not work.
 */
const ProjectArtifactsEmpty = (props: ProjectArtifactsEmptyProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="flex flex-col items-start gap-3 py-4">
      <p className="text-muted-foreground max-w-prose text-sm">
        {tr("artifacts.empty.description")}
      </p>

      {/*
        Verbatim and selectable. A screenshot of a CLI invocation is not
        something anyone can paste into a workflow file.
      */}
      <pre className="bg-muted text-muted-foreground w-full overflow-x-auto rounded-md p-3 text-xs">
        <code>
          {`alepha build\nlore artifacts push --project ${props.projectSlug} --app <app>`}
        </code>
      </pre>

      <p className="text-muted-foreground/70 text-xs">
        {tr("app.artifacts.empty.credential")}
      </p>
    </div>
  );
};

export default ProjectArtifactsEmpty;
