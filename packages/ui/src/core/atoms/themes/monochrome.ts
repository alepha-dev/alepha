import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Paper,
  TextInput,
} from "@mantine/core";
import type { AlephaTheme } from "../../interfaces/AlephaTheme.ts";

/**
 * Monochrome theme.
 *
 * Pure black and white. No color. Bold typography does all the heavy lifting.
 * A design-school statement piece — minimalist color, maximalist type.
 */
export const monochromeTheme: AlephaTheme = {
  name: "Monochrome",
  description: "Pure black and white — zero color, maximum typography",
  primaryColor: "mono",
  primaryShade: { light: 8, dark: 1 },
  autoContrast: true,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  headings: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
    fontWeight: "800",
    textWrap: "wrap",
    sizes: {
      h1: { fontSize: "2.25rem", lineHeight: "1.15" },
      h2: { fontSize: "1.625rem", lineHeight: "1.25" },
      h3: { fontSize: "1.25rem", lineHeight: "1.35" },
      h4: { fontSize: "1.0625rem", lineHeight: "1.45" },
      h5: { fontSize: "0.9375rem", lineHeight: "1.5" },
      h6: { fontSize: "0.8125rem", lineHeight: "1.5" },
    },
  },
  defaultRadius: "0",
  radius: {
    xs: "0",
    sm: "0",
    md: "0",
    lg: "0",
    xl: "2px",
  },
  shadows: {
    xs: "0 1px 2px rgba(0, 0, 0, 0.08)",
    sm: "0 1px 4px rgba(0, 0, 0, 0.1)",
    md: "0 2px 8px rgba(0, 0, 0, 0.12)",
    lg: "0 4px 16px rgba(0, 0, 0, 0.14)",
    xl: "0 8px 32px rgba(0, 0, 0, 0.16)",
  },
  colors: {
    // Primary — pure grayscale
    mono: [
      "#f5f5f5",
      "#e0e0e0",
      "#c0c0c0",
      "#a0a0a0",
      "#808080",
      "#606060",
      "#404040",
      "#282828",
      "#141414",
      "#000000",
    ],
    // Gray — identical to mono for consistency
    gray: [
      "#f5f5f5",
      "#e5e5e5",
      "#cccccc",
      "#b0b0b0",
      "#909090",
      "#707070",
      "#555555",
      "#3a3a3a",
      "#252525",
      "#121212",
    ],
    // "Colors" are all grayscale — no hue anywhere
    blue: [
      "#f5f5f5",
      "#e0e0e0",
      "#c0c0c0",
      "#a0a0a0",
      "#808080",
      "#606060",
      "#404040",
      "#282828",
      "#141414",
      "#000000",
    ],
    green: [
      "#f5f5f5",
      "#e0e0e0",
      "#c0c0c0",
      "#a0a0a0",
      "#808080",
      "#606060",
      "#404040",
      "#282828",
      "#141414",
      "#000000",
    ],
    red: [
      "#f5f5f5",
      "#e0e0e0",
      "#c0c0c0",
      "#a0a0a0",
      "#808080",
      "#606060",
      "#404040",
      "#282828",
      "#141414",
      "#000000",
    ],
    // Dark palette — true blacks
    dark: [
      "#d0d0d0",
      "#a0a0a0",
      "#707070",
      "#505050",
      "#383838",
      "#282828",
      "#1c1c1c",
      "#141414",
      "#0a0a0a",
      "#000000",
    ],
  },

  components: {
    Button: Button.extend({
      defaultProps: {
        fw: 700,
      },
      styles: {
        root: {
          border: "2px solid currentColor",
          letterSpacing: "0.03em",
          textTransform: "uppercase" as const,
          fontSize: "0.8125rem",
        },
      },
    }),

    ActionIcon: ActionIcon.extend({
      styles: {
        root: {
          border: "2px solid currentColor",
        },
      },
    }),

    Paper: Paper.extend({
      styles: {
        root: {
          border: "2px solid var(--mantine-color-default-border)",
        },
      },
    }),

    Card: Card.extend({
      styles: {
        root: {
          border: "2px solid var(--mantine-color-default-border)",
        },
      },
    }),

    TextInput: TextInput.extend({
      styles: {
        input: {
          border: "2px solid var(--mantine-color-default-border)",
        },
      },
    }),

    Badge: Badge.extend({
      defaultProps: {
        fw: 700,
        variant: "outline",
      },
      styles: {
        root: {
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em",
          fontSize: "0.65rem",
          border: "2px solid currentColor",
        },
      },
    }),
  },
};
