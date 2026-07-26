import type { ReactNode } from "react";

export interface DevSectionHeaderProps {
  label: string;
  /**
   * Rendered at the right end of the rule — a button, a link, a live chip.
   */
  action?: ReactNode;
}

/**
 * A page-level section title: small-caps label, then a hairline running to the
 * right edge, with an optional affordance parked at the end.
 *
 * Distinct from `.dt-section-label`, which is the full-bleed banded header used
 * *inside* a detail pane. This one is for padded page bodies, where a banded
 * strip would fight the padding.
 */
export const DevSectionHeader = (props: DevSectionHeaderProps) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      marginBottom: 10,
    }}
  >
    <span
      style={{
        fontSize: 9,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "var(--dt-fg-faint)",
        flex: "none",
      }}
    >
      {props.label}
    </span>
    <span style={{ flex: 1, height: 1, background: "var(--dt-border-soft)" }} />
    {props.action}
  </div>
);
