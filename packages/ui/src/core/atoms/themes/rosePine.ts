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
 * Rosé Pine theme.
 *
 * Muted pinks, golds, and subtle greens on warm dark backgrounds.
 * Cozy, low-contrast, easy on the eyes.
 * Based on the Rosé Pine color philosophy.
 */
export const rosePineTheme: AlephaTheme = {
  name: "Rosé Pine",
  description: "Muted pinks and golds on warm dark backgrounds",
  defaultColorScheme: "dark",
  primaryColor: "rose",
  primaryShade: { light: 5, dark: 4 },
  autoContrast: true,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  headings: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
    fontWeight: "600",
    textWrap: "wrap",
    sizes: {
      h1: { fontSize: "2rem", lineHeight: "1.25" },
      h2: { fontSize: "1.5rem", lineHeight: "1.3" },
      h3: { fontSize: "1.25rem", lineHeight: "1.4" },
      h4: { fontSize: "1rem", lineHeight: "1.5" },
      h5: { fontSize: "0.875rem", lineHeight: "1.5" },
      h6: { fontSize: "0.75rem", lineHeight: "1.5" },
    },
  },
  defaultRadius: "md",
  radius: {
    xs: "4px",
    sm: "6px",
    md: "8px",
    lg: "12px",
    xl: "16px",
  },
  shadows: {
    xs: "0 1px 3px rgba(0, 0, 0, 0.2)",
    sm: "0 2px 6px rgba(0, 0, 0, 0.2)",
    md: "0 4px 12px rgba(0, 0, 0, 0.25)",
    lg: "0 8px 24px rgba(0, 0, 0, 0.3)",
    xl: "0 12px 36px rgba(0, 0, 0, 0.35)",
  },
  colors: {
    // Primary — rose
    rose: [
      "#faf0f4",
      "#f2d8e3",
      "#eabdd0",
      "#e0a0bb",
      "#d4849f",
      "#c4748f",
      "#b06282",
      "#9a5275",
      "#7a3f5e",
      "#5c2e47",
    ],
    // Accent — gold
    gold: [
      "#fdf8ec",
      "#f8ecc8",
      "#f2dda0",
      "#eacb72",
      "#e0b94d",
      "#c9a33e",
      "#a98830",
      "#866b24",
      "#634f1a",
      "#403310",
    ],
    // Pine — muted green
    pine: [
      "#ecf5f0",
      "#d0e6da",
      "#add4be",
      "#86c0a0",
      "#62ac84",
      "#4e9670",
      "#3e7a5a",
      "#2f5e44",
      "#20412f",
      "#12251b",
    ],
    // Foam — muted teal
    foam: [
      "#edf6f7",
      "#d2e9eb",
      "#b0d9dd",
      "#8bc6cc",
      "#6ab3bb",
      "#569da5",
      "#438088",
      "#33636a",
      "#23454a",
      "#14292c",
    ],
    // Love — muted red
    red: [
      "#f9eef0",
      "#efd3d8",
      "#e3b2bb",
      "#d68e9b",
      "#c86c7c",
      "#b25566",
      "#944454",
      "#733442",
      "#52252f",
      "#33161d",
    ],
    // Warm grays — subtle mauve tint
    gray: [
      "#f4f0f2",
      "#e4dde1",
      "#cec5cb",
      "#b5aab2",
      "#9a8e96",
      "#7e737a",
      "#635a60",
      "#4a4248",
      "#332d31",
      "#1e1a1c",
    ],
    // Dark palette — Rosé Pine base/surface/overlay
    dark: [
      "#e0d8e0",
      "#b0a6b2",
      "#817786",
      "#615768",
      "#4a3f54",
      "#3a3044",
      "#2a2436",
      "#211e2e",
      "#1a1724",
      "#110f1a",
    ],
  },

  components: {
    Button: Button.extend({
      defaultProps: {
        fw: 500,
      },
      styles: {
        root: {
          transition: "background-color 0.15s ease, opacity 0.15s ease",
        },
      },
    }),

    ActionIcon: ActionIcon.extend({
      styles: {
        root: {
          transition: "background-color 0.15s ease, opacity 0.15s ease",
        },
      },
    }),

    Paper: Paper.extend({
      defaultProps: {
        shadow: "sm",
      },
      styles: {
        root: {
          border: "1px solid var(--mantine-color-default-border)",
        },
      },
    }),

    Card: Card.extend({
      defaultProps: {
        shadow: "sm",
      },
      styles: {
        root: {
          border: "1px solid var(--mantine-color-default-border)",
        },
      },
    }),

    TextInput: TextInput.extend({
      styles: {
        input: {
          border: "1px solid var(--mantine-color-default-border)",
        },
      },
    }),

    Badge: Badge.extend({
      defaultProps: {
        fw: 500,
      },
    }),
  },
};
