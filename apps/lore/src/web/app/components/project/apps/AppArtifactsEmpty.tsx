import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../../services/I18n.ts";

export interface AppArtifactsEmptyProps {
  /**
   * The project's slug, so the command the panel prints is the one this reader
   * would actually run.
   */
  projectSlug: string;
  /**
   * The app's name, for the same reason.
   */
  appName: string;
}

/**
 * What the Artifacts card renders before anything has ever been pushed.
 *
 * ⚠️ Not an error and not a blank. Every other block on this page is derived
 * from telemetry the app itself pushes, so "empty" there means an app that has
 * not reported yet. Artifacts come from CI, a second foreign system that can be
 * absent entirely - an app with no CI integration has telemetry and zero
 * artifacts forever, and that is a normal state rather than a fault.
 *
 * Which makes "here is the command" the only useful thing this screen can say,
 * the same conclusion the Quality tab reached.
 */
const AppArtifactsEmpty = (props: AppArtifactsEmptyProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="flex flex-col items-start gap-3 py-4">
      <p className="text-muted-foreground max-w-prose text-sm">
        {tr("app.artifacts.empty.description")}
      </p>

      {/*
        Verbatim and selectable. A screenshot of a CLI invocation is not
        something anyone can paste into a workflow file.

        ⚠️ It WRAPS rather than scrolling (feedback #P2145). A `pre` does not
        wrap by default, so a command longer than the column got a
        horizontal scrollbar and was cut mid-word - on the one panel whose
        whole job is telling a reader what to type, at 1920px with the page
        mostly empty. `break-words` is what handles the long token in the
        middle of it, a project slug, which `pre-wrap` alone would push past
        the edge on its own.

        The width is not the fix and was not the cause: nothing here is
        capped by `@alepha/ui`, and widening a shared empty state to suit
        one panel would move the same clipping onto a phone.

        ⚠️ `text-left` because the shared empty state is `text-center`, and
        a command centred over three wrapped lines is harder to read than
        the scrolling one was. Set here rather than there: that class is
        `AlephaTable`'s own empty and no-match states, and every table in
        the app inherits it.
      */}
      <pre className="bg-muted text-muted-foreground w-full rounded-md p-3 text-left text-xs break-words whitespace-pre-wrap">
        <code>
          {`alepha build\nlore artifacts push --project ${props.projectSlug} --app ${props.appName}`}
        </code>
      </pre>

      <p className="text-muted-foreground/70 text-xs">
        {tr("app.artifacts.empty.credential")}
      </p>
    </div>
  );
};

export default AppArtifactsEmpty;
