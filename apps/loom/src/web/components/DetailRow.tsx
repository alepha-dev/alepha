import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface DetailRowProps {
  label: string;
  /**
   * Set the value in the monospace face: shas, paths, branch names.
   */
  mono?: boolean;
  children: ReactNode;
}

/**
 * One label and its value inside a `DetailGroup`.
 */
export const DetailRow = (props: DetailRowProps) => {
  return (
    <>
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words",
          props.mono && "font-mono text-[12px]",
        )}
      >
        {props.children}
      </dd>
    </>
  );
};
