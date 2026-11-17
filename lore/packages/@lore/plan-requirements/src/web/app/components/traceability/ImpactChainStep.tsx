import type { ReactNode } from "react";

export interface ImpactChainStepProps {
  label: string;
  /**
   * The dot's colour, a background class.
   */
  tone: string;
  children: ReactNode;
}

/**
 * One step of a requirement's impact chain (#E153): a dot, what the step
 * is, and what it holds.
 */
const ImpactChainStep = (props: ImpactChainStepProps) => (
  <li className="relative flex gap-3 pb-3">
    <span className={`mt-1 size-2.5 shrink-0 rounded-full ${props.tone}`} />
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px] font-semibold uppercase">
        {props.label}
      </span>
      {props.children}
    </div>
  </li>
);

export default ImpactChainStep;
