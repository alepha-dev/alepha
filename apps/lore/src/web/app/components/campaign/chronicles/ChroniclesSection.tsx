import type { ReactNode } from "react";

export interface ChroniclesSectionProps {
  title: string;
  /** Optional right-aligned control (e.g. a range select). */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * Flat dashboard section — a heading + body separated from the next section
 * by a bottom border. The Chronicles redesign replaces `<Card>` walls with
 * these.
 */
const ChroniclesSection = (props: ChroniclesSectionProps) => {
  return (
    <section className="flex flex-col gap-3 border-b border-border pb-8">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {props.title}
        </h3>
        {props.action}
      </div>
      {props.children}
    </section>
  );
};

export default ChroniclesSection;
