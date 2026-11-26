import { type I18n, StackTraceViewer } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

export interface ProjectErrorStackProps {
  name: string;
  message: string;
  stack: string;
}

/**
 * An error's stack trace, read rather than dumped (#Q4186): the viewer the
 * stack dialog used, which carries its own copy button.
 *
 * ⚠️ SECURITY: `name`, `message` and `stack` come from an application's
 * runtime. Plain React text only, through `StackTraceViewer`: never
 * markdown, never `dangerouslySetInnerHTML`.
 */
const ProjectErrorStack = (props: ProjectErrorStackProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <section className="flex min-w-0 flex-col gap-2" data-testid="error-stack">
      <h2 className="text-sm font-semibold">{tr("errors.stack.title")}</h2>
      <div className="min-w-0 overflow-auto">
        {props.stack ? (
          <StackTraceViewer
            stack={props.stack}
            name={props.name}
            message={props.message}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            {tr("errors.stack.empty")}
          </p>
        )}
      </div>
    </section>
  );
};

export default ProjectErrorStack;
