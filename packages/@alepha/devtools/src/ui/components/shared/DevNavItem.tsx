import type { ComponentType } from "react";

export interface DevNavItemProps {
  label: string;
  icon: ComponentType<{ size?: number }>;
  count?: number;
  active?: boolean;
  /**
   * Marks a screen whose content keeps arriving while you are not looking at
   * it. Shown instead of a count, because a number that is stale the moment it
   * renders is worse than no number.
   */
  live?: boolean;
  /**
   * Omitted for sections whose screen isn't ported yet. The item still renders
   * — the nav is the map of what the application declares, and hiding the
   * unported half would misrepresent it — but reads as unavailable.
   */
  onSelect?: () => void;
}

export const DevNavItem = (props: DevNavItemProps) => {
  const Icon = props.icon;
  const disabled = !props.onSelect;

  return (
    <button
      type="button"
      className="dt-nav-item"
      data-active={props.active || undefined}
      onClick={props.onSelect}
      disabled={disabled}
      title={disabled ? `${props.label} — not ported yet` : undefined}
      style={disabled ? { opacity: 0.4, cursor: "default" } : undefined}
    >
      <Icon size={13} />
      <span>{props.label}</span>
      {props.live ? (
        <span className="dt-live-dot" style={{ marginLeft: "auto" }} />
      ) : (
        props.count !== undefined && (
          <span className="dt-nav-count">{props.count}</span>
        )
      )}
    </button>
  );
};
