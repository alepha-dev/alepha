import { Title } from "@mantine/core";
import type { ComponentType, ReactNode } from "react";
import { ui } from "../constants/ui.ts";
import { renderIcon } from "../helpers/renderIcon.tsx";
import type { ActionProps } from "./buttons/ActionButton.tsx";
import ActionButton from "./buttons/ActionButton.tsx";
import Flex from "./Flex.tsx";
import Text from "./Text.tsx";

export interface SectionHeaderProps {
  /**
   * Icon displayed before the title.
   * Accepts a React element or a component type (e.g. `IconUser` from tabler).
   */
  icon?: ReactNode | ComponentType<{ size?: number }>;

  /**
   * Main title text.
   */
  title: string | ReactNode;

  /**
   * Optional tag displayed after the title (e.g. a Badge or status text).
   */
  tag?: ReactNode;

  /**
   * Subtitle displayed below the title.
   */
  subtitle?: string | ReactNode;

  /**
   * Action buttons displayed on the right side.
   */
  actions?: ActionProps[];

  /**
   * Controls the title size and icon size.
   *
   * - `"sm"` → Title order 5, icon 16px
   * - `"md"` → Title order 4, icon 20px (default)
   * - `"lg"` → Title order 3, icon 24px
   */
  size?: "sm" | "md" | "lg";

  /**
   * Extra content appended to the right side (after actions).
   */
  extra?: ReactNode;
}

const TITLE_ORDER: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  sm: 5,
  md: 4,
  lg: 3,
};

const ICON_SIZE: Record<string, number> = {
  sm: ui.sizes.icon.xs,
  md: ui.sizes.icon.sm,
  lg: ui.sizes.icon.md,
};

const SectionHeader = (props: SectionHeaderProps) => {
  const { icon, title, tag, subtitle, actions, size = "md", extra } = props;

  const iconSize = ICON_SIZE[size];
  const titleOrder = TITLE_ORDER[size];

  return (
    <Flex col gap={2}>
      <Flex centerY gap="xs">
        {icon && (
          <Flex centerY style={{ flexShrink: 0 }}>
            {renderIcon(icon, iconSize)}
          </Flex>
        )}
        <Title order={titleOrder} lh={1.2}>
          {title}
        </Title>
        {tag}
        <Flex fill />
        {actions && actions.length > 0 && (
          <Flex gap="xs" centerY style={{ flexShrink: 0 }}>
            {actions.map((actionProps, index) => (
              <ActionButton
                key={index}
                size="xs"
                variant="default"
                {...actionProps}
              />
            ))}
          </Flex>
        )}
        {extra}
      </Flex>
      {subtitle && (
        <Text muted small>
          {subtitle}
        </Text>
      )}
    </Flex>
  );
};

export default SectionHeader;
