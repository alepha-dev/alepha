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
 * Soft Brutalism theme.
 *
 * Pastel pop palette with solid offset shadows, rounded corners, and bold borders.
 * A friendlier take on neubrutalism — playful but production-ready.
 */
export const softBrutalismTheme: AlephaTheme = {
  name: "Soft Brutalism",
  description: "Pastel pop with bold borders and offset shadows",
  head: {
    link: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossorigin: "",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap",
      },
    ],
  },
  primaryColor: "lavender",
  primaryShade: { light: 5, dark: 7 },
  autoContrast: true,
  cursorType: "pointer",
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  headings: {
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
    fontWeight: "700",
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
    xs: "6px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
  },
  shadows: {
    xs: "2px 2px 0 0 rgba(100, 80, 140, 0.15)",
    sm: "3px 3px 0 0 rgba(100, 80, 140, 0.2)",
    md: "4px 4px 0 0 rgba(100, 80, 140, 0.2)",
    lg: "6px 6px 0 0 rgba(100, 80, 140, 0.25)",
    xl: "8px 8px 0 0 rgba(100, 80, 140, 0.3)",
  },
  colors: {
    // Primary — lavender
    lavender: [
      "#f3f0fa",
      "#e4dcf4",
      "#d1c4e9",
      "#b4a7d6",
      "#9a8bc4",
      "#7f6cb0",
      "#6a549e",
      "#543f87",
      "#3d2d6b",
      "#2a1d52",
    ],
    // Accent — peach
    peach: [
      "#fef3ec",
      "#fce4d0",
      "#f9d0ae",
      "#f4b886",
      "#f4a261",
      "#e68a42",
      "#c67234",
      "#a35a28",
      "#6b3a1a",
      "#4a2710",
    ],
    // Success — mint
    mint: [
      "#ecfaf0",
      "#d4f2dc",
      "#b3e8c2",
      "#8edba4",
      "#81c995",
      "#5ab874",
      "#42a05c",
      "#2e8548",
      "#1a5c2e",
      "#0f3f1e",
    ],
    // Danger — coral
    coral: [
      "#fef0ef",
      "#fcd9d7",
      "#f8b8b4",
      "#f29490",
      "#e97171",
      "#d65454",
      "#b83e3e",
      "#962d2d",
      "#6b1f1f",
      "#4a1414",
    ],
    // Warm grays — cream-shifted
    gray: [
      "#faf8f6",
      "#f0ece8",
      "#ddd7d0",
      "#c4bbb2",
      "#a89e95",
      "#8c8279",
      "#6e655d",
      "#524b44",
      "#3a342f",
      "#24211e",
    ],
    // Warm dark palette — lavender-tinted blacks
    dark: [
      "#d4d0dc",
      "#a9a2b5",
      "#7e7690",
      "#5c546e",
      "#443c56",
      "#342d45",
      "#2a2339",
      "#1e1a2e",
      "#161224",
      "#0f0c1a",
    ],
  },

  // ---------------------------------------------------------------------------
  // Component overrides
  // ---------------------------------------------------------------------------

  components: {
    Button: Button.extend({
      defaultProps: {
        fw: 600,
      },
      styles: {
        root: {
          border: "2px solid currentColor",
          boxShadow: "3px 3px 0 0 rgba(100, 80, 140, 0.2)",
          transition: "box-shadow 0.15s ease, transform 0.15s ease",
        },
      },
    }),

    ActionIcon: ActionIcon.extend({
      styles: {
        root: {
          border: "2px solid currentColor",
          boxShadow: "2px 2px 0 0 rgba(100, 80, 140, 0.15)",
        },
      },
    }),

    Paper: Paper.extend({
      defaultProps: {
        shadow: "sm",
      },
      styles: {
        root: {
          border: "2px solid var(--mantine-color-default-border)",
        },
      },
    }),

    Card: Card.extend({
      defaultProps: {
        shadow: "sm",
      },
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
          transition: "box-shadow 0.15s ease, border-color 0.15s ease",
        },
      },
    }),

    Badge: Badge.extend({
      defaultProps: {
        fw: 600,
      },
      styles: {
        root: {
          border: "2px solid currentColor",
        },
      },
    }),
  },
};
