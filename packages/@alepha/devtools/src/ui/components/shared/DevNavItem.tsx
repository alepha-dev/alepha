import type { ComponentType } from "react";

export interface DevNavItemProps {
  label: string;
  icon: ComponentType<{ size?: number }>;
  count?: number;
  active?: boolean;
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
      {props.count !== undefined && (
        <span className="dt-nav-count">{props.count}</span>
      )}
    </button>
  );
};
