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
}

const Flex = forwardRef<HTMLDivElement, FlexProps>((props, ref) => {
  const { fill, center, centerX, centerY, col, ...rest } = props;

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

  return <MantineFlex ref={ref} {...rest} />;
});

Flex.displayName = "Flex";

export default Flex;
