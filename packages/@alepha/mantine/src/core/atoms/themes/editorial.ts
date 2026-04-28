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
 * Editorial theme.
 *
 * Serif typography, high contrast black and white, thin borders, generous whitespace.
 * Newspaper/magazine aesthetic — elegant restraint.
 */
export const editorialTheme: AlephaTheme = {
  name: "Editorial",
  description: "Serif typography with newspaper elegance",
  defaultColorScheme: "light",
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
        href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap",
      },
    ],
  },
  primaryColor: "ink",
  primaryShade: { light: 7, dark: 3 },
  autoContrast: true,
  fontFamily: '"Source Serif 4", "Georgia", "Times New Roman", serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  headings: {
    fontFamily: '"Playfair Display", "Georgia", "Times New Roman", serif',
    fontWeight: "700",
    textWrap: "wrap",
    sizes: {
      h1: { fontSize: "2.5rem", lineHeight: "1.15" },
      h2: { fontSize: "1.75rem", lineHeight: "1.2" },
      h3: { fontSize: "1.375rem", lineHeight: "1.3" },
      h4: { fontSize: "1.125rem", lineHeight: "1.4" },
      h5: { fontSize: "1rem", lineHeight: "1.5" },
      h6: { fontSize: "0.875rem", lineHeight: "1.5" },
    },
  },
  defaultRadius: "sm",
  radius: {
    xs: "2px",
    sm: "3px",
    md: "4px",
    lg: "6px",
    xl: "8px",
  },
  shadows: {
    xs: "0 1px 2px rgba(0, 0, 0, 0.06)",
    sm: "0 1px 3px rgba(0, 0, 0, 0.08)",
    md: "0 2px 6px rgba(0, 0, 0, 0.08)",
    lg: "0 4px 12px rgba(0, 0, 0, 0.1)",
    xl: "0 8px 24px rgba(0, 0, 0, 0.1)",
  },
  colors: {
    // Primary — ink black with warm tint
    ink: [
      "#f5f3f0",
      "#e8e4de",
      "#d4cec5",
      "#b5ad9f",
      "#8c8272",
      "#6b6050",
      "#4a4035",
      "#332b22",
      "#1f1812",
      "#0d0a07",
    ],
    // Accent — muted burgundy
    burgundy: [
      "#faf0f0",
      "#f0d4d4",
      "#e0adad",
      "#cc8585",
      "#b35e5e",
      "#944545",
      "#763636",
      "#5a2828",
      "#3d1b1b",
      "#220f0f",
    ],
    // Warm grays — paper-tinted
    gray: [
      "#faf9f7",
      "#f0eee9",
      "#e0dcd5",
      "#c8c2b8",
      "#a8a194",
      "#8a8273",
      "#6b6456",
      "#504a3f",
      "#36322b",
      "#1e1b17",
    ],
    // Dark palette — warm charcoal
    dark: [
      "#d5d2cd",
      "#aba59c",
      "#817a6e",
      "#5e584e",
      "#46413a",
      "#36322c",
      "#2a2721",
      "#201d19",
      "#171411",
      "#0d0b09",
    ],
  },

  components: {
    Button: Button.extend({
      defaultProps: {
        fw: 600,
      },
      styles: {
        root: {
          letterSpacing: "0.02em",
        },
      },
    }),

    ActionIcon: ActionIcon.extend({
      styles: {
        root: {
          border: "1px solid var(--mantine-color-default-border)",
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
        },
      },
    }),

    Badge: Badge.extend({
      defaultProps: {
        fw: 600,
        variant: "outline",
      },
      styles: {
        root: {
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          letterSpacing: "0.04em",
          textTransform: "uppercase" as const,
          fontSize: "0.65rem",
        },
      },
    }),
  },
};
