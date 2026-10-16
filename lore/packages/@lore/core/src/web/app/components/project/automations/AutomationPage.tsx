import type { ReactNode } from "react";

export interface AutomationPageProps {
  title: ReactNode;
  description?: ReactNode;
  /**
   * Drawn beside the title, a state badge for one rule.
   */
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}

/**
 * The frame every Automations page shares with Uptime and the other project
 * pages: a bordered header naming the page, its actions on the right, and a
 * scrolling body holding a readable column.
 */
const AutomationPage = (props: AutomationPageProps) => {
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      data-testid={props.testId}
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold break-words">{props.title}</h1>
            {props.badge}
          </div>
          {props.description && (
            <p className="text-muted-foreground mt-1 text-sm">
              {props.description}
            </p>
          )}
        </div>
        {props.actions && (
          <div className="flex flex-wrap items-center gap-2">
            {props.actions}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="flex max-w-3xl flex-col gap-6">{props.children}</div>
      </div>
    </section>
  );
};

export default AutomationPage;
