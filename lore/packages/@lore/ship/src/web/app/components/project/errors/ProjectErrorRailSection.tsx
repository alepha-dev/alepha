import type { ReactNode } from "react";

export interface ProjectErrorRailSectionProps {
  title: string;
  testId?: string;
  children: ReactNode;
}

/**
 * One titled block of the error page's rail.
 */
const ProjectErrorRailSection = (props: ProjectErrorRailSectionProps) => (
  <section
    className="border-border flex flex-col gap-1 border-b pb-3 last:border-b-0"
    data-testid={props.testId}
  >
    <h2 className="text-muted-foreground pb-1 text-[11px] font-semibold tracking-wide uppercase">
      {props.title}
    </h2>
    {props.children}
  </section>
);

export default ProjectErrorRailSection;
