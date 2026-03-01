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

  /**
   * Add rounded corners to the container. If `true`, a default border radius will be applied. You can also specify a custom border radius value (e.g., "sm", "md", "lg", or any valid CSS border-radius value).
   */
  rounded?: boolean | number | string;

  /**
   * Add a border to the container. The color will be determined by the current theme.
   */
  bordered?: boolean;

  /**
   * Add a top border only.
   */
  borderedTop?: boolean;

  /**
   * Add a bottom border only.
   */
  borderedBottom?: boolean;

  /**
   * Add a shadow to the container. The intensity will be determined by the current theme.
   */
  shadowed?: boolean | number | string;

  /**
   * Set overflow to "auto" to enable scrolling when content overflows the container.
   */
  overflow?: boolean;
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
    rounded,
    bordered,
    borderedTop,
    borderedBottom,
    shadowed,
    overflow,
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

  if (rounded) {
    rest.bdrs = rounded === true ? "md" : rounded;
  }

  if (bordered) {
    rest.bd = "1px solid var(--alepha-border)";
  }

  if (borderedTop) {
    rest.style = {
      borderTop: "1px solid var(--alepha-border)",
      ...((rest.style as object) ?? {}),
    };
  }

  if (borderedBottom) {
    rest.style = {
      borderBottom: "1px solid var(--alepha-border)",
      ...((rest.style as object) ?? {}),
    };
  }

  if (shadowed) {
    rest.className =
      `${rest.className ?? ""} shadow-${shadowed === true ? "md" : shadowed}`.trim();
  }

  if (overflow) {
    rest.className = `${rest.className ?? ""} overflow-auto`.trim();
  }

  return <MantineFlex ref={ref} {...rest} />;
});

Flex.displayName = "Flex";

export default Flex;
