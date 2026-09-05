import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface SpecimenProps {
  title: string;
  /**
   * One short line, or nothing.
   */
  description?: string;
  children: ReactNode;
  /**
   * Lays the variants out in a wrapping row instead of a column, for anything
   * small enough to compare side by side.
   */
  inline?: boolean;
}

/**
 * One labelled group of variants, full width.
 */
export const Specimen = (props: SpecimenProps) => (
  <section className="border-border/60 rounded-lg border">
    <header className="border-border/60 border-b px-4 py-2">
      <h3 className="text-sm font-medium">{props.title}</h3>
      {props.description ? (
        <p className="text-muted-foreground text-xs">{props.description}</p>
      ) : null}
    </header>
    <div
      className={cn(
        "p-4",
        props.inline ? "flex flex-wrap items-center gap-3" : "space-y-4",
      )}
    >
      {props.children}
    </div>
  </section>
);
