import type { MantineThemeOverride } from "@mantine/core";

export const theme = {
  mantine: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    fontFamilyMonospace:
      'Inconsolata, "Fira Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
    primaryColor: "green",
    primaryShade: {
      light: 9,
      dark: 7,
    },
  } as MantineThemeOverride,

  sidebarWidth: 300,
  sidebarBreakpoint: "md",

  headerHeight: { base: 64 },
  footerHeight: 32,
};
