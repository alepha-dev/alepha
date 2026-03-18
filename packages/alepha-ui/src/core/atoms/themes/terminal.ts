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
 * Terminal theme.
 *
 * Monospace everything, green-on-black, zero radius.
 * CRT/hacker aesthetic for developer tools and dashboards.
 */
export const terminalTheme: AlephaTheme = {
  name: "Terminal",
  description: "Green phosphor on black — monospace hacker aesthetic",
  defaultColorScheme: "dark",
  primaryColor: "terminal",
  primaryShade: { light: 5, dark: 4 },
  autoContrast: true,
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  headings: {
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    fontWeight: "700",
    textWrap: "wrap",
    sizes: {
      h1: { fontSize: "1.75rem", lineHeight: "1.3" },
      h2: { fontSize: "1.375rem", lineHeight: "1.35" },
      h3: { fontSize: "1.125rem", lineHeight: "1.4" },
      h4: { fontSize: "1rem", lineHeight: "1.5" },
      h5: { fontSize: "0.875rem", lineHeight: "1.5" },
      h6: { fontSize: "0.75rem", lineHeight: "1.5" },
    },
  },
  defaultRadius: "0",
  radius: {
    xs: "0",
    sm: "0",
    md: "0",
    lg: "2px",
    xl: "4px",
  },
  shadows: {
    xs: "none",
    sm: "none",
    md: "0 0 8px rgba(0, 255, 65, 0.08)",
    lg: "0 0 16px rgba(0, 255, 65, 0.1)",
    xl: "0 0 24px rgba(0, 255, 65, 0.12)",
  },
  colors: {
    // Primary — phosphor green
    terminal: [
      "#e6fff0",
      "#b3ffd1",
      "#80ffb3",
      "#4dff94",
      "#00ff41",
      "#00d636",
      "#00ad2b",
      "#008521",
      "#005c17",
      "#00330d",
    ],
    // Amber accent
    amber: [
      "#fff8e6",
      "#ffecb3",
      "#ffe080",
      "#ffd54d",
      "#ffca28",
      "#d4a520",
      "#aa8418",
      "#806310",
      "#554208",
      "#2b2104",
    ],
    // Danger — red
    red: [
      "#ffe6e6",
      "#ffb3b3",
      "#ff8080",
      "#ff4d4d",
      "#ff1a1a",
      "#d41515",
      "#aa1010",
      "#800c0c",
      "#550808",
      "#2b0404",
    ],
    // Cool grays
    gray: [
      "#e8eaed",
      "#c8cdd3",
      "#a4aab3",
      "#808892",
      "#5f6872",
      "#474f58",
      "#363c44",
      "#282d33",
      "#1c2026",
      "#12151a",
    ],
    // True black darks
    dark: [
      "#c9cdd2",
      "#8b9198",
      "#5c636b",
      "#3d444c",
      "#2b3138",
      "#1e242b",
      "#151a20",
      "#0e1216",
      "#080c0f",
      "#020303",
    ],
  },

  components: {
    Button: Button.extend({
      defaultProps: {
        fw: 600,
      },
      styles: {
        root: {
          border: "1px solid currentColor",
          textTransform: "uppercase" as const,
          letterSpacing: "0.05em",
          fontSize: "0.8125rem",
        },
      },
    }),

    ActionIcon: ActionIcon.extend({
      styles: {
        root: {
          border: "1px solid currentColor",
        },
      },
    }),

    Paper: Paper.extend({
      styles: {
        root: {
          border: "1px solid var(--mantine-color-default-border)",
        },
      },
    }),

    Card: Card.extend({
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
          fontFamily: "inherit",
        },
      },
    }),

    Badge: Badge.extend({
      defaultProps: {
        fw: 600,
      },
      styles: {
        root: {
          border: "1px solid currentColor",
          textTransform: "uppercase" as const,
          letterSpacing: "0.05em",
        },
      },
    }),
  },
};
