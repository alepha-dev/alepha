import {
  Text as MantineText,
  type TextProps as MantineTextProps,
} from "@mantine/core";
import { forwardRef, type ReactNode } from "react";
import type { AlephaIntent } from "../interfaces/AlephaIntent.ts";

export interface TextProps extends MantineTextProps {
  children?: ReactNode;

  /**
   * Semantic color intent for the text.
   */
  intent?: AlephaIntent;

  /**
   * Shorthand for fw={700}.
   */
  bold?: boolean;

  /**
   * Shorthand for fs="italic".
   */
  italic?: boolean;

  /**
   * Shorthand for fw={300}.
   */
  light?: boolean;

  /**
   * Shorthand for c="dimmed".
   */
  muted?: boolean;

  /**
   * Shorthand for size="sm".
   */
  small?: boolean;

  /**
   * Shorthand for tt="uppercase".
   */
  uppercase?: boolean;

  /**
   * Shorthand for tt="capitalize".
   */
  capitalize?: boolean;

  /**
   * Shorthand for ta="center".
   */
  center?: boolean;

  /**
   * Shorthand for ff="monospace".
   */
  monospace?: boolean;

  /**
   * Text with title styles (larger font size, bolder weight).
   */
  title?: boolean;
}

const INTENT_COLORS: Record<AlephaIntent, string> = {
  primary: "blue",
  info: "cyan",
  success: "green",
  warning: "yellow",
  danger: "red",
};

const Text = forwardRef<HTMLParagraphElement, TextProps>((props, ref) => {
  const {
    intent,
    bold,
    italic,
    light,
    muted,
    small,
    uppercase,
    capitalize,
    center,
    monospace,
    title,
    ...rest
  } = props;

  if (intent) {
    rest.c ??= INTENT_COLORS[intent];
  }

  if (bold) {
    rest.fw ??= 700;
  }

  if (light) {
    rest.fw ??= 300;
  }

  if (italic) {
    rest.fs ??= "italic";
  }

  if (muted) {
    rest.c ??= "dimmed";
  }

  if (small) {
    rest.size ??= "sm";
  }

  if (uppercase) {
    rest.tt ??= "uppercase";
  }

  if (capitalize) {
    rest.tt ??= "capitalize";
  }

  if (center) {
    rest.ta ??= "center";
  }

  if (monospace) {
    rest.ff ??= "monospace";
  }

  if (title) {
    rest.size ??= "xl";
  }

  return <MantineText ref={ref} {...rest} />;
});

Text.displayName = "Text";

export default Text;
