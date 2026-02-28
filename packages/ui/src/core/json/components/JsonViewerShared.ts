import type { MantineSize } from "@mantine/core";
import type { CSSProperties } from "react";

// =============================================================================
// TYPES
// =============================================================================

export interface JsonTreeNode {
  value: string;
  label: string;
  children?: JsonTreeNode[];
  nodeValue: any;
  nodeKey: string | undefined;
  path: string[];
  isArrayItem: boolean;
  isRoot?: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const SIZE_CONFIG: Record<
  MantineSize,
  { icon: number; levelOffset: number }
> = {
  xs: { icon: 14, levelOffset: 16 },
  sm: { icon: 16, levelOffset: 20 },
  md: { icon: 18, levelOffset: 24 },
  lg: { icon: 20, levelOffset: 28 },
  xl: { icon: 22, levelOffset: 32 },
};

export const STYLES = {
  root: {
    fontFamily: "var(--mantine-font-family-monospace)",
  } satisfies CSSProperties,
  chevron: {
    flexShrink: 0,
    color: "var(--mantine-color-dimmed)",
  } satisfies CSSProperties,
  key: {
    color: "var(--mantine-color-cyan-text)",
    fontWeight: 500,
  } satisfies CSSProperties,
  colon: {
    color: "var(--mantine-color-dimmed)",
  } satisfies CSSProperties,
  string: {
    color: "var(--mantine-color-teal-text)",
  } satisfies CSSProperties,
  number: {
    color: "var(--mantine-color-blue-text)",
  } satisfies CSSProperties,
  boolean: {
    color: "var(--mantine-color-violet-text)",
  } satisfies CSSProperties,
  null: {
    color: "var(--mantine-color-dimmed)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  preview: {
    color: "var(--mantine-color-dimmed)",
  } satisfies CSSProperties,
};

// =============================================================================
// HELPERS
// =============================================================================

export const getValueType = (val: any): string => {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (Array.isArray(val)) return "array";
  return typeof val;
};
