import type { ReactNode } from "react";

export interface SwaggerSectionProps {
  title: ReactNode;
  /**
   * A quiet note at the end of the heading line (the media types of a body).
   */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * A titled block of the operation view.
 */
export const SwaggerSection = (props: SwaggerSectionProps) => {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{props.title}</h3>
        {props.aside && (
          <span className="text-muted-foreground font-mono text-xs">
            {props.aside}
          </span>
        )}
      </div>
      {props.children}
    </section>
  );
};
