import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface SpecimenProps {
  title: string;
  description?: string;
  children: ReactNode;
  /**
   * Lays the variants out in a wrapping row instead of a column. For anything
   * small enough to compare side by side - buttons, badges, switches - seeing
   * them on one line is the whole value of a specimen.
   */
  inline?: boolean;
}

/**
 * One labelled group of variants.
 *
 * The showcase is a reference, so every specimen states what it is showing.
 * A wall of unlabelled components is a screenshot, not a catalogue.
 */
export const Specimen = (props: SpecimenProps) => (
  <section className="border-border/60 rounded-lg border">
    <header className="border-border/60 border-b px-4 py-3">
      <h3 className="text-sm font-medium">{props.title}</h3>
      {props.description ? (
        <p className="text-muted-foreground mt-0.5 text-xs">
          {props.description}
        </p>
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
