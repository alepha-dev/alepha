import {
  Flex as MantineFlex,
  type FlexProps as MantineFlexProps,
} from "@mantine/core";
import { forwardRef } from "react";

export interface FlexProps extends MantineFlexProps {
  /**
   * flex: 1 — fill available space.
   */
  fill?: boolean;

  /**
   * Shorthand for align="center" + justify="center".
   */
  center?: boolean;

  /**
   * Shorthand for justify="center".
   */
  centerX?: boolean;

  /**
   * Shorthand for align="center".
   */
  centerY?: boolean;

  /**
   * Shorthand for direction="column".
   */
  col?: boolean;

  /**
   * Set ground to `var(--alepha-ground)`.
   */
  ground?: boolean;

  /**
   * Set ground to `var(--alepha-surface)`.
   */
  surface?: boolean;

  /**
   * Set ground to `var(--alepha-elevated)`.
   */
  elevated?: boolean;
}

const Flex = forwardRef<HTMLDivElement, FlexProps>((props, ref) => {
  const {
    fill,
    center,
    centerX,
    centerY,
    col,
    ground,
    surface,
    elevated,
    ...rest
  } = props;

  if (fill) {
    rest.flex ??= 1;
  }

  if (col) {
    rest.direction ??= "column";
  }

  if (center) {
    rest.align ??= "center";
    rest.justify ??= "center";
  }

  if (centerX) {
    rest.justify ??= "center";
  }

  if (centerY) {
    rest.align ??= "center";
  }

  if (ground) {
    rest.bg = "var(--alepha-ground)";
  } else if (surface) {
    rest.bg = "var(--alepha-surface)";
  } else if (elevated) {
    rest.bg = "var(--alepha-elevated)";
  }

  return <MantineFlex ref={ref} {...rest} />;
});

Flex.displayName = "Flex";

export default Flex;
